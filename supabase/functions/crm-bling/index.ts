import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { buildBlingCatalog, blingCreateSaleOrder, blingEmitNfe, blingFindOrCreateContato, getValidBlingToken } from '../_shared/bling.ts'
import { resolveCepBrasil } from '../_shared/cep.ts'
import { PAGBANK_KITS } from '../_shared/pagbank.ts'
import { REDE_KITS, inferRedeKit } from '../_shared/rede.ts'
import { insertInteraction } from '../_shared/crm.ts'

// Ações autenticadas do Bling para o frontend.
//  list_products      -> catálogo (nome, código, preço, estoque) do polo ativo
//  get_order_config   -> { default_contato_id, auto_order_enabled }
//  set_order_config   -> grava { default_contato_id?, auto_order_enabled? }
//  create_test_order  -> cria um pedido de teste no Bling para um kit

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'unauthorized' }, 401)

  let payload: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const { data: tid } = await userClient.rpc('current_tenant_id')
  const tenantId = typeof tid === 'string' ? tid.trim() : ''
  if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)

  const action = String(payload.action ?? '')

  if (action === 'list_products') {
    try {
      const out = await buildBlingCatalog(admin, tenantId, { forceRefresh: payload.refresh === true })
      return json({ ok: true, items: out.items, fetchedAt: out.fetchedAt, fromCache: out.fromCache })
    } catch (e) {
      return json({ ok: false, error: 'bling_catalog_failed', message: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

  if (action === 'get_order_config') {
    const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle()
    const cfg = ((data as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
    return json({
      ok: true,
      default_contato_id: cfg.default_contato_id != null ? String(cfg.default_contato_id) : '',
      auto_order_enabled: cfg.auto_order_enabled === true,
      natureza_operacao_id: cfg.natureza_operacao_id != null ? String(cfg.natureza_operacao_id) : '',
      auto_nfe_transmit: cfg.auto_nfe_transmit === true,
    })
  }

  if (action === 'set_order_config') {
    const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle()
    const cfg = ((data as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
    const next = { ...cfg }
    if (payload.default_contato_id !== undefined) {
      next.default_contato_id = String(payload.default_contato_id ?? '').trim()
    }
    if (payload.auto_order_enabled !== undefined) {
      next.auto_order_enabled = payload.auto_order_enabled === true
    }
    if (payload.natureza_operacao_id !== undefined) {
      next.natureza_operacao_id = String(payload.natureza_operacao_id ?? '').trim()
    }
    if (payload.auto_nfe_transmit !== undefined) {
      next.auto_nfe_transmit = payload.auto_nfe_transmit === true
    }
    await admin.from('tenant_integrations').upsert({ tenant_id: tenantId, bling: next })
    return json({ ok: true })
  }

  if (action === 'create_test_order') {
    const kit = String(payload.kit ?? '3_meses')
    const amountCents = PAGBANK_KITS[kit]?.amountCents ?? 18905
    try {
      const out = await blingCreateSaleOrder(admin, tenantId, { kit, amountCents, customerName: 'Pedido de teste' })
      return json({ ok: true, orderId: out.orderId, bottles: out.bottles })
    } catch (e) {
      return json({ ok: false, error: 'bling_order_failed', message: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

  // retry_bling: cria/relança o pedido no Bling para uma venda JÁ PAGA que não entrou
  // (ex.: lead veio pelo canal da clínica comprando Tricopill, ou bug do kit null).
  // Kit Tricopill → SEMPRE no tenant 'tricopill' (onde vive a config do Bling).
  if (action === 'retry_bling') {
    const leadId = String(payload.leadId ?? '').trim()
    if (!leadId) return json({ ok: false, error: 'missing_lead' }, 400)

    const { data: leadRow } = await admin
      .from('leads').select('id, patient_name, phone, custom_fields').eq('id', leadId).maybeSingle()
    const lead = leadRow as { id: string; patient_name?: string; phone?: string; custom_fields?: Record<string, unknown> } | null
    if (!lead) return json({ ok: false, error: 'lead_not_found' }, 404)

    // Pagamento pago mais recente SEM pedido Bling (cartão tem a coluna bling_order_id; Pix não).
    const { data: rede } = await admin
      .from('rede_payments').select('id, kit, amount_cents, installments, bling_order_id')
      .eq('lead_id', leadId).eq('status', 'paid').is('bling_order_id', null)
      .order('paid_at', { ascending: false }).limit(1).maybeSingle()
    const { data: pb } = await admin
      .from('pagbank_checkouts').select('checkout_id, kit, amount_cents')
      .eq('lead_id', leadId).eq('status', 'paid')
      .order('paid_at', { ascending: false }).limit(1).maybeSingle()

    const pay = (rede as { id: string; kit?: string; amount_cents?: number } | null)
      ?? (pb ? { id: (pb as { checkout_id: string }).checkout_id, kit: (pb as { kit?: string }).kit, amount_cents: (pb as { amount_cents?: number }).amount_cents } : null)
    if (!pay) return json({ ok: false, error: 'nenhuma_venda_paga_sem_bling' }, 404)

    // kit: payload > kit salvo > inferido pelo valor pago (cobre o caso do total com frete embutido).
    const kit = payload.kit != null ? String(payload.kit) : (pay.kit ?? inferRedeKit(Number(pay.amount_cents ?? 0)) ?? '')

    // AVULSO (sem kit): puxa a descrição da última "Venda confirmada" (ex.: "Tricopill + Shampoo").
    let description: string | undefined
    if (!kit) {
      const { data: conf } = await admin
        .from('interactions').select('content').eq('lead_id', leadId)
        .ilike('content', '%Venda confirmada%').order('happened_at', { ascending: false }).limit(1).maybeSingle()
      const c = String((conf as { content?: string } | null)?.content ?? '')
      const m = c.match(/Venda confirmada:\s*(.+?)\s*[—-]\s*R\$/i)
      description = (payload.description != null ? String(payload.description) : (m?.[1] ?? '').trim()) || 'Venda avulsa Tricopill'
    }

    const cad = ((lead.custom_fields?.cadastro as Record<string, string>) ?? {})
    try {
      const productCents = kit
        ? (REDE_KITS[kit]?.amountCents ?? PAGBANK_KITS[kit]?.amountCents ?? Number(pay.amount_cents ?? 0))
        : Number(pay.amount_cents ?? 0)
      const out = await blingCreateSaleOrder(admin, 'tricopill', {
        kit, amountCents: productCents, description,
        customerName: String(cad.nomeCompleto || lead.patient_name || 'Cliente Tricopill').trim(),
        phone: lead.phone ? String(lead.phone) : undefined,
        cpf: cad.cpf, email: cad.email, dataNascimento: cad.dataNascimento, sexo: cad.sexo,
        entrega: ((lead.custom_fields as Record<string, unknown> | undefined)?.entrega as {
          cep?: string; numero?: string; complemento?: string
          bairro?: string; logradouro?: string; cidade?: string; uf?: string; delivery_mode?: string
        }) ?? undefined,
      })
      if (rede) await admin.from('rede_payments').update({ bling_order_id: out.orderId ?? null }).eq('id', (rede as { id: string }).id)
      await insertInteraction(admin, {
        leadId, patientName: String(cad.nomeCompleto || lead.patient_name || 'Cliente'), channel: 'system', direction: 'system',
        author: 'Bling',
        content: kit
          ? `📦 Pedido relançado no Bling (#${out.orderId ?? '?'}, ${out.bottles} frascos).`
          : `📦 Pedido AVULSO relançado no Bling (#${out.orderId ?? '?'}): ${description}. Confira itens/estoque no Bling.`,
        tenantId: 'tricopill',
      })
      return json({ ok: true, orderId: out.orderId, bottles: out.bottles })
    } catch (e) {
      return json({ ok: false, error: 'bling_order_failed', message: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

  // sync_contato: cria/atualiza o contato REAL do cliente no Bling a partir do cadastro/
  // endereço do lead e, se já houver pedido vinculado, corrige o contato desse pedido.
  // Usado pelo botão "Atualizar no Bling" da ficha (conserta cadastro incompleto).
  if (action === 'sync_contato') {
    const leadId = String(payload.leadId ?? '').trim()
    if (!leadId) return json({ ok: false, error: 'missing_lead' }, 400)

    const { data: leadRow } = await admin
      .from('leads').select('id, patient_name, phone, custom_fields').eq('id', leadId).maybeSingle()
    const lead = leadRow as { id: string; patient_name?: string; phone?: string; custom_fields?: Record<string, unknown> } | null
    if (!lead) return json({ ok: false, error: 'lead_not_found' }, 404)

    const cf = (lead.custom_fields ?? {}) as Record<string, unknown>
    const cad = (cf.cadastro ?? {}) as Record<string, string>
    const ent = (cf.entrega ?? {}) as Record<string, string>
    const nome = String(cad.nomeCompleto || lead.patient_name || '').trim()
    if (!nome) return json({ ok: false, error: 'sem_nome' }, 400)

    // Kit Tricopill → config do Bling vive no tenant 'tricopill'.
    const token = await getValidBlingToken(admin, 'tricopill')
    if (!token) return json({ ok: false, error: 'bling_indisponivel' }, 502)

    // Endereço completo via ViaCEP (mesma fonte do fechamento de venda).
    const cep = String(ent.cep ?? '').replace(/\D/g, '')
    let endereco: Record<string, string | undefined> | undefined
    if (cep.length === 8) {
      const info = (!ent.cidade || !ent.uf || !ent.logradouro) ? await resolveCepBrasil(cep).catch(() => null) : null
      endereco = {
        rua: ent.logradouro || info?.logradouro,
        numero: ent.numero,
        complemento: ent.complemento,
        bairro: ent.bairro || info?.bairro,
        cep,
        municipio: ent.cidade || info?.localidade,
        uf: (ent.uf || info?.uf || '').toUpperCase() || undefined,
      }
    }

    let contatoId: string | null = null
    try {
      contatoId = await blingFindOrCreateContato(token, {
        nome, phone: lead.phone ? String(lead.phone) : undefined,
        cpf: cad.cpf, email: cad.email, dataNascimento: cad.dataNascimento, sexo: cad.sexo,
        endereco,
      })
    } catch (e) {
      return json({ ok: false, error: 'contato_falhou', message: e instanceof Error ? e.message : String(e) }, 502)
    }
    if (!contatoId) return json({ ok: false, error: 'contato_nao_criado' }, 502)

    // Se houver pedido de cartão vinculado (rede_payments.bling_order_id), troca o contato dele.
    let orderUpdated = false
    const { data: rede } = await admin
      .from('rede_payments').select('bling_order_id')
      .eq('lead_id', leadId).not('bling_order_id', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const orderId = String((rede as { bling_order_id?: string } | null)?.bling_order_id ?? '').trim()
    if (orderId) {
      try {
        const bh = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' }
        const gr = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`, { headers: bh })
        if (gr.ok) {
          const o = (JSON.parse((await gr.text()) || '{}')?.data ?? {}) as Record<string, unknown>
          const itens = (Array.isArray(o.itens) ? o.itens : []).map((i: Record<string, unknown>) => ({
            produto: { id: ((i.produto ?? {}) as Record<string, unknown>).id }, descricao: i.descricao, quantidade: i.quantidade, valor: i.valor,
          }))
          const putPayload: Record<string, unknown> = { contato: { id: Number(contatoId) || contatoId }, data: o.data, itens }
          if (o.observacoes) putPayload.observacoes = o.observacoes
          const tr = (o.transporte ?? {}) as Record<string, unknown>
          if (Number(tr.frete) > 0) putPayload.transporte = { frete: tr.frete, fretePorConta: tr.fretePorConta ?? 1 }
          const pr = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`, { method: 'PUT', headers: bh, body: JSON.stringify(putPayload) })
          orderUpdated = pr.ok
        }
      } catch {
        // best-effort: o contato já foi criado/atualizado, o pedido pode ser corrigido depois
      }
    }

    await insertInteraction(admin, {
      leadId, patientName: nome, channel: 'system', direction: 'system', author: 'Bling',
      content: orderUpdated
        ? `🔄 Cadastro sincronizado no Bling (contato #${contatoId}) e pedido #${orderId} atualizado.`
        : `🔄 Cadastro sincronizado no Bling (contato #${contatoId}).`,
      tenantId: 'tricopill',
    })
    return json({ ok: true, contatoId, orderUpdated })
  }

  // stock_entry: espelha no Bling uma ENTRADA de estoque (compra/NF-e importada no CRM).
  // O saldo que vende (site/bot/PDV) vive no Bling, então a entrada da nota é empurrada pra cá.
  if (action === 'stock_entry') {
    const blingProductId = String(payload.blingProductId ?? '').trim()
    const qty = Number(payload.qty ?? 0)
    const unitCostCents = Number(payload.unitCostCents ?? 0)
    const note = String(payload.note ?? 'Entrada por NF-e (CRM)').slice(0, 200)
    if (!blingProductId || !(qty > 0)) return json({ ok: false, error: 'dados_invalidos' }, 400)

    const token = await getValidBlingToken(admin, 'tricopill')
    if (!token) return json({ ok: false, error: 'bling_indisponivel' }, 502)
    const bh = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' }

    try {
      // Depósito padrão (o Bling exige depósito na movimentação de estoque).
      let depositoId = ''
      const dr = await fetch('https://api.bling.com.br/Api/v3/depositos', { headers: bh })
      if (dr.ok) {
        const deps = (JSON.parse((await dr.text()) || '{}')?.data ?? []) as Array<Record<string, unknown>>
        depositoId = String((deps.find((d) => d.padrao === true) ?? deps[0] ?? {}).id ?? '')
      }
      if (!depositoId) return json({ ok: false, error: 'deposito_nao_encontrado' }, 502)

      const custoReais = unitCostCents > 0 ? Math.round(unitCostCents) / 100 : undefined
      const body: Record<string, unknown> = {
        produto: { id: Number(blingProductId) || blingProductId },
        deposito: { id: Number(depositoId) || depositoId },
        operacao: 'E',
        quantidade: qty,
        observacoes: note,
        ...(custoReais != null ? { preco: custoReais, custo: custoReais } : {}),
      }
      const er = await fetch('https://api.bling.com.br/Api/v3/estoques', { method: 'POST', headers: bh, body: JSON.stringify(body) })
      const txt = await er.text()
      if (!er.ok) return json({ ok: false, error: 'bling_estoque_falhou', status: er.status, message: txt.slice(0, 300) }, 502)
      const movId = (JSON.parse(txt || '{}')?.data as { id?: unknown })?.id ?? null
      return json({ ok: true, movementId: movId != null ? String(movId) : null, depositoId })
    } catch (e) {
      return json({ ok: false, error: 'bling_estoque_erro', message: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

  // nfe_list: vendas PAGAS com pedido no Bling num intervalo de datas (pós-conciliação),
  // com o estado atual da NF-e. NF-e/Bling é do polo Tricopill. Base pra tela de emissão em lote.
  if (action === 'nfe_list') {
    const from = String(payload.from ?? '').trim() // 'YYYY-MM-DD'
    const to = String(payload.to ?? '').trim()
    const startIso = /^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00-03:00` : ''
    const endIso = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59-03:00` : ''
    let q = admin
      .from('rede_payments')
      .select('id, lead_id, amount_cents, method, paid_at, bling_order_id, customer_name, customer_doc, nfe_id, nfe_numero, nfe_status, nfe_error')
      .eq('tenant_id', 'tricopill')
      .eq('status', 'paid')
      .not('bling_order_id', 'is', null)
      .order('paid_at', { ascending: true })
    if (startIso) q = q.gte('paid_at', startIso)
    if (endIso) q = q.lte('paid_at', endIso)
    const { data: rows } = await q
    const list = (rows ?? []) as Array<Record<string, unknown>>
    // Completa nome/CPF pelo cadastro do lead quando o pagamento não tem.
    const leadIds = [...new Set(list.map((r) => String(r.lead_id ?? '')).filter(Boolean))]
    const leadMap = new Map<string, { nome?: string; cpf?: string }>()
    if (leadIds.length) {
      const { data: leads } = await admin.from('leads').select('id, patient_name, custom_fields').in('id', leadIds)
      for (const l of (leads ?? []) as Array<Record<string, unknown>>) {
        const cad = (((l.custom_fields ?? {}) as Record<string, unknown>).cadastro ?? {}) as Record<string, unknown>
        leadMap.set(String(l.id), {
          nome: String(cad.nomeCompleto ?? l.patient_name ?? '').trim() || undefined,
          cpf: String(cad.cpf ?? '').replace(/\D/g, '') || undefined,
        })
      }
    }
    const items = list.map((r) => {
      const lead = leadMap.get(String(r.lead_id ?? '')) ?? {}
      const cpf = String(r.customer_doc ?? '').replace(/\D/g, '') || lead.cpf || ''
      return {
        paymentId: String(r.id),
        leadId: String(r.lead_id ?? ''),
        name: String(r.customer_name ?? '').trim() || lead.nome || 'Cliente',
        cpf,
        valueCents: Number(r.amount_cents ?? 0),
        method: String(r.method ?? ''),
        paidAt: r.paid_at ?? null,
        blingOrderId: String(r.bling_order_id ?? ''),
        nfeStatus: r.nfe_status != null ? String(r.nfe_status) : null,
        nfeNumero: r.nfe_numero != null ? String(r.nfe_numero) : null,
        nfeError: r.nfe_error != null ? String(r.nfe_error) : null,
      }
    })
    return json({ ok: true, items })
  }

  // nfe_emit: emite a NF-e de UMA venda paga (a tela chama uma por vez, em lote). Puxa itens
  // e contato do pedido do Bling e chama blingEmitNfe. Requer natureza_operacao_id configurada,
  // CPF do comprador (nota PF) e o PRODUTO com ficha fiscal (NCM/CFOP) — senão o SEFAZ rejeita.
  if (action === 'nfe_emit') {
    const paymentId = String(payload.paymentId ?? '').trim()
    if (!paymentId) return json({ ok: false, error: 'missing_payment' }, 400)

    const { data: payRow } = await admin
      .from('rede_payments')
      .select('id, lead_id, bling_order_id, customer_doc, customer_name, nfe_numero')
      .eq('tenant_id', 'tricopill').eq('id', paymentId).maybeSingle()
    const pay = payRow as {
      id: string; lead_id?: string; bling_order_id?: string; customer_doc?: string; customer_name?: string; nfe_numero?: string
    } | null
    if (!pay) return json({ ok: false, error: 'venda_nao_encontrada' }, 404)
    if (pay.nfe_numero) return json({ ok: true, alreadyEmitted: true, numero: pay.nfe_numero })
    const orderId = String(pay.bling_order_id ?? '').trim()
    if (!orderId) return json({ ok: false, error: 'sem_pedido_bling' }, 400)

    // natureza de operação (config fiscal — o contador informa o ID no Bling)
    const { data: intRow } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', 'tricopill').maybeSingle()
    const bcfg = ((intRow as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
    const naturezaOperacaoId = String(bcfg.natureza_operacao_id ?? '').trim()
    if (!naturezaOperacaoId) {
      return json({ ok: false, error: 'natureza_nao_configurada', message: 'Configure a natureza de operação da NF-e antes de emitir.' }, 400)
    }
    const transmit = payload.transmit !== undefined ? payload.transmit === true : bcfg.auto_nfe_transmit === true

    // CPF do comprador (nota PF exige) — do pagamento ou do cadastro do lead.
    let cpf = String(pay.customer_doc ?? '').replace(/\D/g, '')
    if (cpf.length !== 11 && pay.lead_id) {
      const { data: l } = await admin.from('leads').select('custom_fields').eq('id', pay.lead_id).maybeSingle()
      const cad = ((((l as { custom_fields?: Record<string, unknown> } | null)?.custom_fields ?? {}).cadastro ?? {}) as Record<string, unknown>)
      cpf = String(cad.cpf ?? '').replace(/\D/g, '')
    }
    if (cpf.length !== 11) {
      const msg = 'Sem CPF do cliente — a nota de pessoa física exige CPF. Complete o cadastro.'
      await admin.from('rede_payments').update({ nfe_status: 'erro', nfe_error: msg }).eq('id', paymentId)
      return json({ ok: false, error: 'sem_cpf', message: msg })
    }

    const token = await getValidBlingToken(admin, 'tricopill')
    if (!token) return json({ ok: false, error: 'bling_indisponivel' }, 502)

    // Itens + contato vêm do pedido já criado no Bling (mesmo caminho do sync_contato).
    let contatoId = ''
    let itens: Array<Record<string, unknown>> = []
    try {
      const bh = { Authorization: 'Bearer ' + token, Accept: 'application/json' }
      const gr = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`, { headers: bh })
      if (!gr.ok) return json({ ok: false, error: 'pedido_bling_nao_lido', status: gr.status }, 502)
      const o = (JSON.parse((await gr.text()) || '{}')?.data ?? {}) as Record<string, unknown>
      contatoId = String(((o.contato ?? {}) as Record<string, unknown>).id ?? '')
      itens = (Array.isArray(o.itens) ? o.itens : []).map((i: Record<string, unknown>) => ({
        produto: { id: ((i.produto ?? {}) as Record<string, unknown>).id },
        descricao: i.descricao, quantidade: i.quantidade, valor: i.valor,
      }))
    } catch (e) {
      return json({ ok: false, error: 'pedido_bling_erro', message: e instanceof Error ? e.message : String(e) }, 502)
    }
    if (!contatoId || itens.length === 0) return json({ ok: false, error: 'pedido_sem_itens_ou_contato' }, 400)

    try {
      const out = await blingEmitNfe(token, { naturezaOperacaoId, contatoId, itens, transmit })
      const status = out.error ? 'erro' : (out.transmitted ? 'emitida' : 'rascunho')
      await admin.from('rede_payments').update({
        nfe_id: out.nfeId, nfe_numero: out.numero ?? null, nfe_status: status,
        nfe_error: out.error ?? null, nfe_emitted_at: new Date().toISOString(),
      }).eq('id', paymentId)
      if (out.error) return json({ ok: false, error: 'nfe_falhou', message: out.error })
      return json({ ok: true, nfeId: out.nfeId, numero: out.numero ?? null, status, transmitted: out.transmitted })
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 400)
      await admin.from('rede_payments').update({ nfe_status: 'erro', nfe_error: msg }).eq('id', paymentId)
      return json({ ok: false, error: 'nfe_falhou', message: msg })
    }
  }

  return json({ error: 'unknown_action' }, 400)
})
