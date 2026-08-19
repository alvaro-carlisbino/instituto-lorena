import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { buildBlingCatalog, blingCreateSaleOrder, blingEmitNfe, blingFindOrCreateContato, blingOrderLabel, getValidBlingToken } from '../_shared/bling.ts';
import { resolveCepBrasil } from '../_shared/cep.ts';
import { PAGBANK_KITS } from '../_shared/pagbank.ts';
import { REDE_KITS, inferRedeKit } from '../_shared/rede.ts';
import { insertInteraction } from '../_shared/crm.ts';
import { quoteGatewayFee } from '../_shared/gatewayFees.ts';
// Ações autenticadas do Bling para o frontend.
//  list_products      -> catálogo (nome, código, preço, estoque) do polo ativo
//  get_order_config   -> { default_contato_id, auto_order_enabled }
//  set_order_config   -> grava { default_contato_id?, auto_order_enabled? }
//  create_test_order  -> cria um pedido de teste no Bling para um kit
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json'
    }
  });
}
/**
 * GET no Bling com retry em 429/5xx. O Bling corta em 3 requisições por SEGUNDO e uma
 * emissão de NF-e gasta 4-6 chamadas; em lote, o estouro caía nestes GETs e a função
 * devolvia 502, que na tela virava o inútil "Edge Function returned a non-2xx status code"
 * (caso Kauan 25/jul/2026). Respeita Retry-After; senão 700ms → 1400ms → 2800ms.
 */ async function blingGet(url, headers, attempts = 4) {
  let res = await fetch(url, {
    headers
  });
  for(let i = 1; i < attempts && (res.status === 429 || res.status >= 500); i++){
    const raSec = Number(res.headers.get('retry-after') ?? '');
    const wait = Number.isFinite(raSec) && raSec > 0 ? Math.min(raSec * 1000, 5000) : 700 * 2 ** (i - 1);
    await new Promise((r)=>setTimeout(r, wait));
    res = await fetch(url, {
      headers
    });
  }
  return res;
}
/**
 * Monta os itens da NF-e a partir dos itens do PEDIDO, completando com o cadastro fiscal
 * do produto.
 *
 * A pegadinha (achada em 27/jul/2026, causa das 10 notas que não transmitiam):
 * o Bling casa o item da nota com o produto pelo **`codigo`**, não pelo `produto.id`. Vários
 * produtos da linha Ligabue estão cadastrados SEM código, e o fallback que a gente usava —
 * mandar o id interno como código — fazia o Bling não encontrar o cadastro e emitir o item
 * **sem NCM**, o que derruba a transmissão. Tirar o código também não dá: sem ele o Bling
 * recusa na hora ("Codigo do produto X deve ser informado"). A saída é mandar a tributação
 * EXPLÍCITA no item (testado: com `classificacaoFiscal` o NCM entra mesmo com código falso).
 *
 * `unidade` idem: vem no item do pedido e no cadastro, mas a gente descartava — a nota
 * nascia com unidade comercial vazia.
 */ async function buildNfeItens(brutos, bh) {
  const cache = new Map();
  const itens = [];
  for (const i of brutos){
    const prodId = (i.produto ?? {}).id;
    const key = String(prodId ?? '');
    let cad = cache.get(key);
    if (!cad && prodId) {
      cad = {};
      const pr = await blingGet(`https://api.bling.com.br/Api/v3/produtos/${prodId}`, bh);
      if (pr.ok) cad = JSON.parse(await pr.text() || '{}')?.data ?? {};
      cache.set(key, cad);
    }
    const trib = cad?.tributacao ?? {};
    const ncm = String(trib.ncm ?? '').trim();
    const cest = String(trib.cest ?? '').trim();
    const gtin = String(cad?.gtin ?? '').trim();
    const codigo = String(i.codigo ?? '').trim() || String(cad?.codigo ?? '').trim() || key;
    const unidade = String(i.unidade ?? '').trim() || String(cad?.unidade ?? '').trim() || 'UN';
    itens.push({
      codigo,
      produto: {
        id: prodId
      },
      descricao: i.descricao,
      quantidade: i.quantidade,
      valor: i.valor,
      unidade: unidade.slice(0, 6),
      ...ncm ? {
        classificacaoFiscal: ncm
      } : {},
      ...cest ? {
        cest
      } : {},
      ...gtin ? {
        gtin
      } : {},
      origem: Number(trib.origem ?? 0) || 0
    });
  }
  return itens;
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: cors
  });
  if (req.method !== 'POST') return json({
    error: 'method_not_allowed'
  }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRole) return json({
    error: 'server_misconfigured'
  }, 500);
  const admin = createClient(supabaseUrl, serviceRole);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({
    error: 'unauthorized'
  }, 401);
  // Caminho de máquina: rotinas server-to-server chegam com a própria service_role key no
  // Authorization, e auth.getUser() não devolve usuário para esse token (mesma pegadinha que
  // segurava os follow-ups no crm-send-message). Serve para rodar mutirão de NF-e em lote,
  // que pela tela sairia uma aba aberta por 4 minutos. A plataforma já validou o JWT; o
  // painel continua exigindo usuário real.
  // Comparar o bearer com SUPABASE_SERVICE_ROLE_KEY não serve: a chave injetada na função
  // nem sempre é a mesma que a API do projeto devolve (o projeto tem chave legada e chave
  // nova convivendo), e a igualdade falha calada. Como esta função roda com verify_jwt=true,
  // a plataforma JÁ validou a assinatura antes daqui — então dá para confiar na claim.
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  const isServiceRole = (() => {
    if (bearer.length > 0 && bearer === serviceRole) return true;
    try {
      const parte = bearer.split('.')[1];
      if (!parte) return false;
      const norm = parte.replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(norm.padEnd(norm.length + (4 - norm.length % 4) % 4, '=')));
      return claims?.role === 'service_role';
    } catch {
      return false;
    }
  })();
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });
  if (!isServiceRole) {
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({
      error: 'unauthorized'
    }, 401);
  }
  let payload = {};
  try {
    const raw = await req.text();
    payload = raw ? JSON.parse(raw) : {};
  } catch  {
    return json({
      error: 'invalid_json'
    }, 400);
  }
  // current_tenant_id() lê o polo da SESSÃO; sem usuário ela não resolve, então a chamada
  // de máquina informa o polo no payload.
  let tenantId = '';
  if (isServiceRole) {
    tenantId = String(payload.tenantId ?? '').trim();
  } else {
    const { data: tid } = await userClient.rpc('current_tenant_id');
    tenantId = typeof tid === 'string' ? tid.trim() : '';
  }
  if (!tenantId) return json({
    error: 'tenant_not_resolved'
  }, 400);
  const action = String(payload.action ?? '');
  if (action === 'list_products') {
    try {
      const out = await buildBlingCatalog(admin, tenantId, {
        forceRefresh: payload.refresh === true
      });
      return json({
        ok: true,
        items: out.items,
        fetchedAt: out.fetchedAt,
        fromCache: out.fromCache
      });
    } catch (e) {
      return json({
        ok: false,
        error: 'bling_catalog_failed',
        message: e instanceof Error ? e.message : String(e)
      }, 502);
    }
  }
  if (action === 'get_order_config') {
    const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle();
    const cfg = data?.bling ?? {};
    return json({
      ok: true,
      default_contato_id: cfg.default_contato_id != null ? String(cfg.default_contato_id) : '',
      auto_order_enabled: cfg.auto_order_enabled === true,
      natureza_operacao_id: cfg.natureza_operacao_id != null ? String(cfg.natureza_operacao_id) : '',
      auto_nfe_transmit: cfg.auto_nfe_transmit === true
    });
  }
  if (action === 'set_order_config') {
    const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle();
    const cfg = data?.bling ?? {};
    const next = {
      ...cfg
    };
    if (payload.default_contato_id !== undefined) {
      next.default_contato_id = String(payload.default_contato_id ?? '').trim();
    }
    if (payload.auto_order_enabled !== undefined) {
      next.auto_order_enabled = payload.auto_order_enabled === true;
    }
    if (payload.natureza_operacao_id !== undefined) {
      next.natureza_operacao_id = String(payload.natureza_operacao_id ?? '').trim();
    }
    if (payload.auto_nfe_transmit !== undefined) {
      next.auto_nfe_transmit = payload.auto_nfe_transmit === true;
    }
    await admin.from('tenant_integrations').upsert({
      tenant_id: tenantId,
      bling: next
    });
    return json({
      ok: true
    });
  }
  if (action === 'create_test_order') {
    const kit = String(payload.kit ?? '3_meses');
    // Fallback = preço do frasco avulso. Era 18905 (R$189,05), um preço que NUNCA existiu:
    // o kit de 1 mês é preço único de R$199 no Pix e no cartão (ver PAGBANK_KITS/REDE_KITS).
    // Kit desconhecido caía aqui e gerava pedido no Bling R$9,95 abaixo do cobrado.
    const amountCents = PAGBANK_KITS[kit]?.amountCents ?? 19900;
    try {
      const out = await blingCreateSaleOrder(admin, tenantId, {
        kit,
        amountCents,
        customerName: 'Pedido de teste'
      });
      return json({
        ok: true,
        orderId: out.orderId,
        bottles: out.bottles,
        frascos: out.frascos,
        label: blingOrderLabel(out)
      });
    } catch (e) {
      return json({
        ok: false,
        error: 'bling_order_failed',
        message: e instanceof Error ? e.message : String(e)
      }, 502);
    }
  }
  // retry_bling: cria/relança o pedido no Bling para uma venda JÁ PAGA que não entrou
  // (ex.: lead veio pelo canal da clínica comprando Tricopill, ou bug do kit null).
  // Kit Tricopill → SEMPRE no tenant 'tricopill' (onde vive a config do Bling).
  if (action === 'retry_bling') {
    const leadId = String(payload.leadId ?? '').trim();
    if (!leadId) return json({
      ok: false,
      error: 'missing_lead'
    }, 400);
    const { data: leadRow } = await admin.from('leads').select('id, patient_name, phone, custom_fields').eq('id', leadId).maybeSingle();
    const lead = leadRow;
    if (!lead) return json({
      ok: false,
      error: 'lead_not_found'
    }, 404);
    // Pagamento pago mais recente SEM pedido Bling (cartão tem a coluna bling_order_id; Pix não).
    const { data: rede } = await admin.from('rede_payments').select('id, kit, amount_cents, installments, method, bling_order_id, freight_cents, paid_at, created_at').eq('lead_id', leadId).eq('status', 'paid').is('bling_order_id', null).order('paid_at', {
      ascending: false
    }).limit(1).maybeSingle();
    const { data: pb } = await admin.from('pagbank_checkouts').select('checkout_id, kit, amount_cents').eq('lead_id', leadId).eq('status', 'paid').order('paid_at', {
      ascending: false
    }).limit(1).maybeSingle();
    const pay = rede ?? (pb ? {
      id: pb.checkout_id,
      kit: pb.kit,
      amount_cents: pb.amount_cents
    } : null);
    if (!pay) return json({
      ok: false,
      error: 'nenhuma_venda_paga_sem_bling'
    }, 404);
    // kit: payload > kit salvo > inferido pelo valor pago (cobre o caso do total com frete embutido).
    const kit = payload.kit != null ? String(payload.kit) : pay.kit ?? inferRedeKit(Number(pay.amount_cents ?? 0)) ?? '';
    // AVULSO (sem kit): puxa a descrição da última "Venda confirmada" (ex.: "Tricopill + Shampoo").
    let description;
    if (!kit) {
      const { data: conf } = await admin.from('interactions').select('content').eq('lead_id', leadId).ilike('content', '%Venda confirmada%').order('happened_at', {
        ascending: false
      }).limit(1).maybeSingle();
      const c = String(conf?.content ?? '');
      const m = c.match(/Venda confirmada:\s*(.+?)\s*[—-]\s*R\$/i);
      description = (payload.description != null ? String(payload.description) : (m?.[1] ?? '').trim()) || 'Venda avulsa Tricopill';
    }
    const cad = lead.custom_fields?.cadastro ?? {};
    try {
      // Valor/frete/data REAIS da venda (caso Jean 19/07: o retry pós-meia-noite criava o
      // pedido com a data do DIA DO RETRY, preço de tabela e sem frete — sumia do filtro
      // do dia da venda no Bling e o total não batia com o cartão).
      const redeRow = rede;
      const productCents = Number(pay.amount_cents ?? 0) || (kit ? REDE_KITS[kit]?.amountCents ?? PAGBANK_KITS[kit]?.amountCents ?? 0 : 0);
      const out = await blingCreateSaleOrder(admin, 'tricopill', {
        kit,
        amountCents: productCents,
        description,
        freightCents: Number(redeRow?.freight_cents ?? 0) || undefined,
        saleDateISO: redeRow?.paid_at || redeRow?.created_at || undefined,
        // Relançamento herda o meio de pagamento da venda (Pix/cartão Nx). Só a Rede tem o dado;
        // no PagBank o retry cai sem método e o pedido mantém o padrão do Bling.
        paymentMethod: redeRow?.method,
        installments: redeRow?.installments,
        customerName: String(cad.nomeCompleto || lead.patient_name || 'Cliente Tricopill').trim(),
        phone: lead.phone ? String(lead.phone) : undefined,
        cpf: cad.cpf,
        email: cad.email,
        dataNascimento: cad.dataNascimento,
        sexo: cad.sexo,
        entrega: lead.custom_fields?.entrega ?? undefined
      });
      if (rede) await admin.from('rede_payments').update({
        bling_order_id: out.orderId ?? null
      }).eq('id', rede.id);
      await insertInteraction(admin, {
        leadId,
        patientName: String(cad.nomeCompleto || lead.patient_name || 'Cliente'),
        channel: 'system',
        direction: 'system',
        author: 'Bling',
        content: kit ? `📦 Pedido relançado no Bling (${blingOrderLabel(out)}).` : `📦 Pedido AVULSO relançado no Bling (#${out.orderId ?? '?'}): ${description}. Confira itens/estoque no Bling.`,
        tenantId: 'tricopill'
      });
      return json({
        ok: true,
        orderId: out.orderId,
        bottles: out.bottles,
        frascos: out.frascos,
        label: blingOrderLabel(out)
      });
    } catch (e) {
      return json({
        ok: false,
        error: 'bling_order_failed',
        message: e instanceof Error ? e.message : String(e)
      }, 502);
    }
  }
  // sync_contato: cria/atualiza o contato REAL do cliente no Bling a partir do cadastro/
  // endereço do lead e, se já houver pedido vinculado, corrige o contato desse pedido.
  // Usado pelo botão "Atualizar no Bling" da ficha (conserta cadastro incompleto).
  if (action === 'sync_contato') {
    const leadId = String(payload.leadId ?? '').trim();
    if (!leadId) return json({
      ok: false,
      error: 'missing_lead'
    }, 400);
    const { data: leadRow } = await admin.from('leads').select('id, patient_name, phone, custom_fields').eq('id', leadId).maybeSingle();
    const lead = leadRow;
    if (!lead) return json({
      ok: false,
      error: 'lead_not_found'
    }, 404);
    const cf = lead.custom_fields ?? {};
    const cad = cf.cadastro ?? {};
    const ent = cf.entrega ?? {};
    const nome = String(cad.nomeCompleto || lead.patient_name || '').trim();
    if (!nome) return json({
      ok: false,
      error: 'sem_nome'
    }, 400);
    // Kit Tricopill → config do Bling vive no tenant 'tricopill'.
    const token = await getValidBlingToken(admin, 'tricopill');
    if (!token) return json({
      ok: false,
      error: 'bling_indisponivel'
    }, 502);
    // Endereço completo via ViaCEP (mesma fonte do fechamento de venda).
    const cep = String(ent.cep ?? '').replace(/\D/g, '');
    let endereco;
    if (cep.length === 8) {
      const info = !ent.cidade || !ent.uf || !ent.logradouro ? await resolveCepBrasil(cep).catch(()=>null) : null;
      endereco = {
        rua: ent.logradouro || info?.logradouro,
        numero: ent.numero,
        complemento: ent.complemento,
        bairro: ent.bairro || info?.bairro,
        cep,
        municipio: ent.cidade || info?.localidade,
        uf: (ent.uf || info?.uf || '').toUpperCase() || undefined
      };
    }
    let contatoId = null;
    try {
      contatoId = await blingFindOrCreateContato(token, {
        nome,
        phone: lead.phone ? String(lead.phone) : undefined,
        cpf: cad.cpf,
        email: cad.email,
        dataNascimento: cad.dataNascimento,
        sexo: cad.sexo,
        endereco
      });
    } catch (e) {
      return json({
        ok: false,
        error: 'contato_falhou',
        message: e instanceof Error ? e.message : String(e)
      }, 502);
    }
    if (!contatoId) return json({
      ok: false,
      error: 'contato_nao_criado'
    }, 502);
    // Se houver pedido de cartão vinculado (rede_payments.bling_order_id), troca o contato dele.
    let orderUpdated = false;
    const { data: rede } = await admin.from('rede_payments').select('bling_order_id').eq('lead_id', leadId).not('bling_order_id', 'is', null).order('created_at', {
      ascending: false
    }).limit(1).maybeSingle();
    const orderId = String(rede?.bling_order_id ?? '').trim();
    if (orderId) {
      try {
        const bh = {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        };
        const gr = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`, {
          headers: bh
        });
        if (gr.ok) {
          const o = JSON.parse(await gr.text() || '{}')?.data ?? {};
          const itens = (Array.isArray(o.itens) ? o.itens : []).map((i)=>({
              produto: {
                id: (i.produto ?? {}).id
              },
              descricao: i.descricao,
              quantidade: i.quantidade,
              valor: i.valor
            }));
          const putPayload = {
            contato: {
              id: Number(contatoId) || contatoId
            },
            data: o.data,
            itens
          };
          if (o.observacoes) putPayload.observacoes = o.observacoes;
          const tr = o.transporte ?? {};
          if (Number(tr.frete) > 0) putPayload.transporte = {
            frete: tr.frete,
            fretePorConta: tr.fretePorConta ?? 1
          };
          const pr = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`, {
            method: 'PUT',
            headers: bh,
            body: JSON.stringify(putPayload)
          });
          orderUpdated = pr.ok;
        }
      } catch  {
      // best-effort: o contato já foi criado/atualizado, o pedido pode ser corrigido depois
      }
    }
    await insertInteraction(admin, {
      leadId,
      patientName: nome,
      channel: 'system',
      direction: 'system',
      author: 'Bling',
      content: orderUpdated ? `🔄 Cadastro sincronizado no Bling (contato #${contatoId}) e pedido #${orderId} atualizado.` : `🔄 Cadastro sincronizado no Bling (contato #${contatoId}).`,
      tenantId: 'tricopill'
    });
    return json({
      ok: true,
      contatoId,
      orderUpdated
    });
  }
  // stock_entry: espelha no Bling uma ENTRADA de estoque (compra/NF-e importada no CRM).
  // O saldo que vende (site/bot/PDV) vive no Bling, então a entrada da nota é empurrada pra cá.
  if (action === 'stock_entry') {
    const blingProductId = String(payload.blingProductId ?? '').trim();
    const qty = Number(payload.qty ?? 0);
    const unitCostCents = Number(payload.unitCostCents ?? 0);
    const note = String(payload.note ?? 'Entrada por NF-e (CRM)').slice(0, 200);
    if (!blingProductId || !(qty > 0)) return json({
      ok: false,
      error: 'dados_invalidos'
    }, 400);
    const token = await getValidBlingToken(admin, 'tricopill');
    if (!token) return json({
      ok: false,
      error: 'bling_indisponivel'
    }, 502);
    const bh = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    try {
      // Depósito padrão (o Bling exige depósito na movimentação de estoque).
      let depositoId = '';
      const dr = await fetch('https://api.bling.com.br/Api/v3/depositos', {
        headers: bh
      });
      if (dr.ok) {
        const deps = JSON.parse(await dr.text() || '{}')?.data ?? [];
        depositoId = String((deps.find((d)=>d.padrao === true) ?? deps[0] ?? {}).id ?? '');
      }
      if (!depositoId) return json({
        ok: false,
        error: 'deposito_nao_encontrado'
      }, 502);
      const custoReais = unitCostCents > 0 ? Math.round(unitCostCents) / 100 : undefined;
      const body = {
        produto: {
          id: Number(blingProductId) || blingProductId
        },
        deposito: {
          id: Number(depositoId) || depositoId
        },
        operacao: 'E',
        quantidade: qty,
        observacoes: note,
        ...custoReais != null ? {
          preco: custoReais,
          custo: custoReais
        } : {}
      };
      const er = await fetch('https://api.bling.com.br/Api/v3/estoques', {
        method: 'POST',
        headers: bh,
        body: JSON.stringify(body)
      });
      const txt = await er.text();
      if (!er.ok) return json({
        ok: false,
        error: 'bling_estoque_falhou',
        status: er.status,
        message: txt.slice(0, 300)
      }, 502);
      const movId = JSON.parse(txt || '{}')?.data?.id ?? null;
      return json({
        ok: true,
        movementId: movId != null ? String(movId) : null,
        depositoId
      });
    } catch (e) {
      return json({
        ok: false,
        error: 'bling_estoque_erro',
        message: e instanceof Error ? e.message : String(e)
      }, 502);
    }
  }
  // nfe_list: vendas PAGAS com pedido no Bling num intervalo de datas (pós-conciliação),
  // com o estado atual da NF-e. NF-e/Bling é do polo Tricopill. Base pra tela de emissão em lote.
  if (action === 'nfe_list') {
    const from = String(payload.from ?? '').trim() // 'YYYY-MM-DD'
    ;
    const to = String(payload.to ?? '').trim();
    const startIso = /^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00-03:00` : '';
    const endIso = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59-03:00` : '';
    let q = admin.from('rede_payments').select('id, lead_id, amount_cents, method, paid_at, bling_order_id, customer_name, customer_doc, nfe_id, nfe_numero, nfe_status, nfe_error').eq('tenant_id', 'tricopill').eq('status', 'paid').not('bling_order_id', 'is', null).order('paid_at', {
      ascending: true
    });
    if (startIso) q = q.gte('paid_at', startIso);
    if (endIso) q = q.lte('paid_at', endIso);
    const { data: rows } = await q;
    const list = rows ?? [];
    // Completa nome/CPF pelo cadastro do lead quando o pagamento não tem.
    const leadIds = [
      ...new Set(list.map((r)=>String(r.lead_id ?? '')).filter(Boolean))
    ];
    const leadMap = new Map();
    if (leadIds.length) {
      const { data: leads } = await admin.from('leads').select('id, patient_name, custom_fields').in('id', leadIds);
      for (const l of leads ?? []){
        const cad = (l.custom_fields ?? {}).cadastro ?? {};
        leadMap.set(String(l.id), {
          nome: String(cad.nomeCompleto ?? l.patient_name ?? '').trim() || undefined,
          cpf: String(cad.cpf ?? '').replace(/\D/g, '') || undefined
        });
      }
    }
    const items = list.map((r)=>{
      const lead = leadMap.get(String(r.lead_id ?? '')) ?? {};
      const cpf = String(r.customer_doc ?? '').replace(/\D/g, '') || lead.cpf || '';
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
        nfeError: r.nfe_error != null ? String(r.nfe_error) : null
      };
    });
    return json({
      ok: true,
      items
    });
  }
  // nfe_emit: emite a NF-e de UMA venda paga (a tela chama uma por vez, em lote). Puxa itens
  // e contato do pedido do Bling e chama blingEmitNfe. Requer natureza_operacao_id configurada,
  // CPF do comprador (nota PF) e o PRODUTO com ficha fiscal (NCM/CFOP) — senão o SEFAZ rejeita.
  if (action === 'nfe_emit') {
    const paymentId = String(payload.paymentId ?? '').trim();
    if (!paymentId) return json({
      ok: false,
      error: 'missing_payment'
    }, 400);
    const { data: payRow } = await admin.from('rede_payments').select('id, lead_id, bling_order_id, customer_doc, customer_name, nfe_numero, paid_at').eq('tenant_id', 'tricopill').eq('id', paymentId).maybeSingle();
    const pay = payRow;
    if (!pay) return json({
      ok: false,
      error: 'venda_nao_encontrada'
    }, 404);
    if (pay.nfe_numero) return json({
      ok: true,
      alreadyEmitted: true,
      numero: pay.nfe_numero
    });
    const orderId = String(pay.bling_order_id ?? '').trim();
    if (!orderId) return json({
      ok: false,
      error: 'sem_pedido_bling'
    }, 400);
    // natureza de operação (config fiscal — o contador informa o ID no Bling)
    const { data: intRow } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', 'tricopill').maybeSingle();
    const bcfg = intRow?.bling ?? {};
    const naturezaOperacaoId = String(bcfg.natureza_operacao_id ?? '').trim();
    if (!naturezaOperacaoId) {
      return json({
        ok: false,
        error: 'natureza_nao_configurada',
        message: 'Configure a natureza de operação da NF-e antes de emitir.'
      }, 400);
    }
    const transmit = payload.transmit !== undefined ? payload.transmit === true : bcfg.auto_nfe_transmit === true;
    // CPF do comprador (nota PF exige) — do pagamento ou do cadastro do lead.
    let cpf = String(pay.customer_doc ?? '').replace(/\D/g, '');
    if (cpf.length !== 11 && pay.lead_id) {
      const { data: l } = await admin.from('leads').select('custom_fields').eq('id', pay.lead_id).maybeSingle();
      const cad = (l?.custom_fields ?? {}).cadastro ?? {};
      cpf = String(cad.cpf ?? '').replace(/\D/g, '');
    }
    if (cpf.length !== 11) {
      const msg = 'Sem CPF do cliente — a nota de pessoa física exige CPF. Complete o cadastro.';
      await admin.from('rede_payments').update({
        nfe_status: 'erro',
        nfe_error: msg
      }).eq('id', paymentId);
      return json({
        ok: false,
        error: 'sem_cpf',
        message: msg
      });
    }
    const token = await getValidBlingToken(admin, 'tricopill');
    if (!token) return json({
      ok: false,
      error: 'bling_indisponivel'
    }, 502);
    // Itens + contato vêm do pedido já criado no Bling (mesmo caminho do sync_contato).
    let contatoId = '';
    let descontoReais = 0;
    let freteReais = 0;
    let fretePorConta = 1;
    let itens = [];
    try {
      const bh = {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json'
      };
      const gr = await blingGet(`https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`, bh);
      if (!gr.ok) return json({
        ok: false,
        error: 'pedido_bling_nao_lido',
        status: gr.status
      }, 502);
      const o = JSON.parse(await gr.text() || '{}')?.data ?? {};
      contatoId = String((o.contato ?? {}).id ?? '');
      // Desconto do pedido (Pix 5%, cupom): tem que ir pra nota, senão ela fecha no preço
      // de tabela e não bate com o cobrado.
      descontoReais = Number((o.desconto ?? {}).valor ?? 0) || 0;
      // Frete do pedido: sem isto a nota fecha só nos produtos e sai MENOR do que o cliente
      // pagou (27 das 51 notas de julho/2026 nasceram assim).
      freteReais = Number((o.transporte ?? {}).frete ?? 0) || 0;
      fretePorConta = Number((o.transporte ?? {}).fretePorConta ?? 1);
      itens = await buildNfeItens(Array.isArray(o.itens) ? o.itens : [], bh);
    } catch (e) {
      return json({
        ok: false,
        error: 'pedido_bling_erro',
        message: e instanceof Error ? e.message : String(e)
      }, 502);
    }
    if (!contatoId || itens.length === 0) return json({
      ok: false,
      error: 'pedido_sem_itens_ou_contato'
    }, 400);
    // O contato PRECISA ter CPF no Bling. PUT só com campos explícitos (nunca o GET inteiro —
    // dump do GET já apagou/corrompeu cadastro em outros fluxos). Nome do CRM também entra.
    const customerName = String(pay.customer_name ?? '').trim();
    try {
      const bh = {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      };
      const cr = await fetch(`https://api.bling.com.br/Api/v3/contatos/${contatoId}`, {
        headers: bh
      });
      if (cr.ok) {
        const cd = JSON.parse(await cr.text() || '{}')?.data ?? {};
        const docAtual = String(cd.numeroDocumento ?? '').replace(/\D/g, '');
        const nomeAtual = String(cd.nome ?? '').trim();
        const precisaDoc = !docAtual && cpf.length === 11;
        const precisaNome = !nomeAtual && !!customerName;
        if (precisaDoc || precisaNome) {
          await fetch(`https://api.bling.com.br/Api/v3/contatos/${contatoId}`, {
            method: 'PUT',
            headers: bh,
            body: JSON.stringify({
              nome: nomeAtual || customerName,
              tipo: cd.tipo ?? 'F',
              situacao: cd.situacao ?? 'A',
              numeroDocumento: docAtual || cpf,
              telefone: cd.telefone,
              celular: cd.celular,
              email: cd.email,
              ...cd.endereco ? {
                endereco: cd.endereco
              } : {}
            })
          });
        }
      }
    } catch  {}
    try {
      const out = await blingEmitNfe(token, {
        naturezaOperacaoId,
        contatoId,
        itens,
        transmit,
        dataOperacaoISO: pay.paid_at || undefined,
        descontoReais,
        freteReais,
        fretePorConta,
        contatoNome: customerName || undefined
      });
      const status = out.error ? 'erro' : out.transmitted ? 'emitida' : 'rascunho';
      await admin.from('rede_payments').update({
        nfe_id: out.nfeId,
        nfe_numero: out.numero ?? null,
        nfe_status: status,
        nfe_error: out.error ?? null,
        nfe_emitted_at: new Date().toISOString()
      }).eq('id', paymentId);
      if (out.error) return json({
        ok: false,
        error: 'nfe_falhou',
        message: out.error
      });
      return json({
        ok: true,
        nfeId: out.nfeId,
        numero: out.numero ?? null,
        status,
        transmitted: out.transmitted
      });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 400);
      await admin.from('rede_payments').update({
        nfe_status: 'erro',
        nfe_error: msg
      }).eq('id', paymentId);
      return json({
        ok: false,
        error: 'nfe_falhou',
        message: msg
      });
    }
  }
  // product_update_price: grava preço novo de UM produto no Bling (GET completo + PUT, o
  // Bling não tem PATCH) e derruba o cache do catálogo pra loja/bot verem o preço na hora.
  if (action === 'product_update_price') {
    const productId = String(payload.productId ?? '').trim();
    const precoReais = Number(payload.preco ?? NaN);
    if (!productId || !Number.isFinite(precoReais) || precoReais < 0) {
      return json({
        ok: false,
        error: 'dados_invalidos'
      }, 400);
    }
    const token = await getValidBlingToken(admin, 'tricopill');
    if (!token) return json({
      ok: false,
      error: 'bling_indisponivel'
    }, 502);
    const bh = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    try {
      const gr = await fetch(`https://api.bling.com.br/Api/v3/produtos/${productId}`, {
        headers: bh
      });
      if (!gr.ok) return json({
        ok: false,
        error: 'produto_nao_lido',
        status: gr.status
      }, 502);
      const full = JSON.parse(await gr.text() || '{}')?.data ?? {};
      const precoAntigo = Number(full.preco ?? 0);
      full.preco = precoReais;
      const pr = await fetch(`https://api.bling.com.br/Api/v3/produtos/${productId}`, {
        method: 'PUT',
        headers: bh,
        body: JSON.stringify(full)
      });
      const txt = await pr.text();
      if (!pr.ok) return json({
        ok: false,
        error: 'bling_preco_falhou',
        status: pr.status,
        message: txt.slice(0, 300)
      }, 502);
      try {
        await buildBlingCatalog(admin, 'tricopill', {
          forceRefresh: true
        });
      } catch  {}
      return json({
        ok: true,
        precoAntigo,
        preco: precoReais
      });
    } catch (e) {
      return json({
        ok: false,
        error: 'bling_preco_erro',
        message: e instanceof Error ? e.message : String(e)
      }, 502);
    }
  }
  // stock_adjust: movimentação de estoque manual no Bling (E = entrada, S = saída/baixa),
  // no depósito padrão. Complementa o stock_entry (que é só entrada por NF-e).
  if (action === 'stock_adjust') {
    const blingProductId = String(payload.blingProductId ?? '').trim();
    const qty = Number(payload.qty ?? 0);
    const op = payload.operacao === 'S' ? 'S' : 'E';
    const note = String(payload.note ?? 'Ajuste manual (painel do site)').slice(0, 200);
    if (!blingProductId || !(qty > 0)) return json({
      ok: false,
      error: 'dados_invalidos'
    }, 400);
    const token = await getValidBlingToken(admin, 'tricopill');
    if (!token) return json({
      ok: false,
      error: 'bling_indisponivel'
    }, 502);
    const bh = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    try {
      let depositoId = '';
      const dr = await fetch('https://api.bling.com.br/Api/v3/depositos', {
        headers: bh
      });
      if (dr.ok) {
        const deps = JSON.parse(await dr.text() || '{}')?.data ?? [];
        depositoId = String((deps.find((d)=>d.padrao === true) ?? deps[0] ?? {}).id ?? '');
      }
      if (!depositoId) return json({
        ok: false,
        error: 'deposito_nao_encontrado'
      }, 502);
      const er = await fetch('https://api.bling.com.br/Api/v3/estoques', {
        method: 'POST',
        headers: bh,
        body: JSON.stringify({
          produto: {
            id: Number(blingProductId) || blingProductId
          },
          deposito: {
            id: Number(depositoId) || depositoId
          },
          operacao: op,
          quantidade: qty,
          observacoes: note
        })
      });
      const txt = await er.text();
      if (!er.ok) return json({
        ok: false,
        error: 'bling_estoque_falhou',
        status: er.status,
        message: txt.slice(0, 300)
      }, 502);
      try {
        await buildBlingCatalog(admin, 'tricopill', {
          forceRefresh: true
        });
      } catch  {}
      return json({
        ok: true,
        operacao: op,
        qty
      });
    } catch (e) {
      return json({
        ok: false,
        error: 'bling_estoque_erro',
        message: e instanceof Error ? e.message : String(e)
      }, 502);
    }
  }
  // nfe_backlog: o tamanho do buraco fiscal, medido no BANCO e sem passar pelo Bling.
  //
  // Existe porque a tela de NF-e abria em hoje..hoje: num dia sem venda ela dizia "nenhum
  // pedido no período" enquanto o histórico inteiro de vendas pagas do polo seguia sem uma
  // única nota autorizada — e o cliente já perguntava "não veio nota fiscal?". Não depender do
  // Bling é de propósito: se o token cair, o resto da tela some e este número continua de pé.
  //
  // SÓ LEITURA E CONTAGEM. Não cria, não transmite e não encosta em documento fiscal.
  if (action === 'nfe_backlog') {
    // Guarda de polo: as outras ações de NF-e assumem 'tricopill' na marra; aqui a soma é
    // dinheiro do polo de vendas e não deve aparecer para quem só tem a clínica.
    if (tenantId !== 'tricopill') return json({
      ok: false,
      error: 'nfe_polo_invalido'
    }, 400);
    const from = String(payload.from ?? '').trim() // 'YYYY-MM-DD'
    ;
    const to = String(payload.to ?? '').trim();
    const iniMs = /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.parse(`${from}T00:00:00-03:00`) : null;
    const fimMs = /^\d{4}-\d{2}-\d{2}$/.test(to) ? Date.parse(`${to}T23:59:59-03:00`) : null;
    // O PostgREST devolve no máximo 1000 linhas e CORTA CALADO — um `select` solto aqui
    // daria um backlog menor que o real, que é justamente o erro que esta ação combate.
    // Daí a leitura paginada por range(): a página curta é o fim da tabela, não um teto.
    const PAGINA = 1000;
    const MAX_PAGINAS = 20;
    let parcial = false;
    const lerPaginado = async (pagina)=>{
      const saida = [];
      for(let p = 0; p < MAX_PAGINAS; p++){
        const { data } = await pagina(p * PAGINA, p * PAGINA + PAGINA - 1);
        const linhas = data ?? [];
        saida.push(...linhas);
        if (linhas.length < PAGINA) return saida;
      }
      parcial = true;
      return saida;
    };
    // Os três gateways que já venderam no polo. asaas/pagbank não têm coluna de NF-e: o
    // estado deles só existe em bling_nfe_emissions, pelo id do pedido no Bling.
    const rede = await lerPaginado((de, ate)=>admin.from('rede_payments').select('amount_cents, paid_at, bling_order_id, nfe_status').eq('tenant_id', 'tricopill').eq('status', 'paid').order('paid_at', {
        ascending: true
      }).range(de, ate));
    const asaas = await lerPaginado((de, ate)=>admin.from('asaas_payments').select('amount_cents, paid_at, bling_order_id').eq('tenant_id', 'tricopill').eq('status', 'paid').order('paid_at', {
        ascending: true
      }).range(de, ate));
    const pagbank = await lerPaginado((de, ate)=>admin.from('pagbank_checkouts').select('amount_cents, paid_at, bling_order_id').eq('tenant_id', 'tricopill').eq('status', 'paid').order('paid_at', {
        ascending: true
      }).range(de, ate));
    const emissoes = await lerPaginado((de, ate)=>admin.from('bling_nfe_emissions').select('bling_order_id, nfe_status').eq('tenant_id', 'tricopill').order('bling_order_id', {
        ascending: true
      }).range(de, ate));
    const statusPorPedido = new Map();
    for (const e of emissoes){
      const oid = String(e.bling_order_id ?? '').trim();
      if (oid) statusPorPedido.set(oid, String(e.nfe_status ?? '').trim());
    }
    const zero = ()=>({
        pedidos: 0,
        valorCents: 0
      });
    const novoResumo = ()=>({
        pagos: zero(),
        autorizada: zero(),
        transmitida: zero(),
        semNota: zero(),
        semTentativa: zero(),
        rascunho: zero(),
        erro: zero(),
        semPedidoBling: zero()
      });
    const total = novoResumo();
    const periodo = novoResumo();
    const somar = (r, faixa, cents)=>{
      r[faixa].pedidos += 1;
      r[faixa].valorCents += cents;
    };
    let maisAntigoSemNota = null;
    let maisAntigoMs = Number.POSITIVE_INFINITY;
    for (const p of [
      ...rede,
      ...asaas,
      ...pagbank
    ]){
      const cents = Number(p.amount_cents ?? 0) || 0;
      const pagoEm = p.paid_at != null ? String(p.paid_at) : '';
      const oid = String(p.bling_order_id ?? '').trim();
      // Emissão por pedido manda; nfe_status do pagamento é o espelho antigo.
      const st = (statusPorPedido.get(oid) || String(p.nfe_status ?? '')).trim().toLowerCase();
      // 'emitida' é o 2xx do POST /nfe/{id}/enviar do Bling, ou seja, ACEITE da transmissão. A
      // autorização da SEFAZ é assíncrona e ninguém relê, então contar 'emitida' como autorizada
      // faria a tela afirmar que a nota saiu sem ninguém ter conferido. Faixa própria.
      const faixa = st.includes('autoriz') ? 'autorizada' : st.includes('emit') || st.includes('transmit') || st.includes('enviad') ? 'transmitida' : st.includes('rascunho') ? 'rascunho' : st.includes('erro') || st.includes('rejeit') || st.includes('deneg') ? 'erro' : 'semTentativa';
      const ms = pagoEm ? Date.parse(pagoEm) : NaN;
      const noPeriodo = Number.isFinite(ms) && (iniMs == null || ms >= iniMs) && (fimMs == null || ms <= fimMs);
      const alvos = noPeriodo ? [
        total,
        periodo
      ] : [
        total
      ];
      for (const r of alvos){
        somar(r, 'pagos', cents);
        somar(r, faixa, cents);
        if (faixa !== 'autorizada') somar(r, 'semNota', cents);
        // Venda paga que nunca virou pedido no Bling: não dá nem para tentar a nota por
        // esta tela — precisa do pedido antes. É SUBCONJUNTO de semTentativa, não uma faixa
        // irmã: somar os chips da tela dá mais que o total, e a tela precisa dizer isso.
        if (!oid && faixa === 'semTentativa') somar(r, 'semPedidoBling', cents);
      }
      if (faixa !== 'autorizada' && Number.isFinite(ms) && ms < maisAntigoMs) {
        maisAntigoMs = ms;
        maisAntigoSemNota = pagoEm;
      }
    }
    return json({
      ok: true,
      total,
      periodo: iniMs != null || fimMs != null ? periodo : null,
      maisAntigoSemNota,
      parcial
    });
  }
  // nfe_list_bling: TODOS os pedidos de venda do Bling no período (data do pedido), não só os
  // que nasceram no CRM — inclui pedidos criados direto no Bling e de marketplace. O estado da
  // NF-e vem de bling_nfe_emissions (emissões por pedido) + rede_payments (emissões antigas).
  if (action === 'nfe_list_bling') {
    const from = String(payload.from ?? '').trim() // 'YYYY-MM-DD'
    ;
    const to = String(payload.to ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return json({
        ok: false,
        error: 'periodo_invalido'
      }, 400);
    }
    const token = await getValidBlingToken(admin, 'tricopill');
    if (!token) return json({
      ok: false,
      error: 'bling_indisponivel'
    }, 502);
    const bh = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    };
    const orders = [];
    // Bling limita ~3 req/s e pagina em 100; 10 páginas = 1000 pedidos, muito acima do volume real.
    for(let page = 1; page <= 10; page++){
      const u = `https://api.bling.com.br/Api/v3/pedidos/vendas?pagina=${page}&limite=100&dataInicial=${from}&dataFinal=${to}`;
      const r = await fetch(u, {
        headers: bh
      });
      if (!r.ok) {
        if (page === 1) return json({
          ok: false,
          error: 'bling_pedidos_falhou',
          status: r.status
        }, 502);
        break;
      }
      const data = JSON.parse(await r.text() || '{}')?.data ?? [];
      orders.push(...data);
      if (data.length < 100) break;
      await new Promise((res)=>setTimeout(res, 350));
    }
    const ids = orders.map((o)=>String(o.id));
    const emisMap = new Map();
    const payMap = new Map();
    if (ids.length) {
      const { data: emis } = await admin.from('bling_nfe_emissions').select('bling_order_id, nfe_numero, nfe_status, nfe_error').eq('tenant_id', 'tricopill').in('bling_order_id', ids);
      for (const e of emis ?? [])emisMap.set(String(e.bling_order_id), e);
      const { data: pays } = await admin.from('rede_payments').select('bling_order_id, nfe_numero, nfe_status, nfe_error').eq('tenant_id', 'tricopill').in('bling_order_id', ids);
      for (const p of pays ?? [])payMap.set(String(p.bling_order_id), p);
    }
    const items = orders.map((o)=>{
      const contato = o.contato ?? {};
      const situacao = o.situacao ?? {};
      const st = emisMap.get(String(o.id)) ?? payMap.get(String(o.id)) ?? {};
      return {
        orderId: String(o.id),
        orderNumero: String(o.numero ?? ''),
        date: String(o.data ?? ''),
        name: String(contato.nome ?? '').trim() || 'Cliente',
        cpf: String(contato.numeroDocumento ?? '').replace(/\D/g, ''),
        valueCents: Math.round(Number(o.total ?? 0) * 100),
        // 12 = "Cancelado" padrão do módulo de vendas do Bling (a UI trava a seleção).
        canceled: Number(situacao.id ?? 0) === 12,
        nfeStatus: st.nfe_status != null ? String(st.nfe_status) : null,
        nfeNumero: st.nfe_numero != null ? String(st.nfe_numero) : null,
        nfeError: st.nfe_error != null ? String(st.nfe_error) : null
      };
    });
    return json({
      ok: true,
      items
    });
  }
  // bling_sales_list: TODOS os pedidos de venda do Bling num período, classificados por
  // origem — 'crm' (casado com pagamento rede/asaas pelo bling_order_id) ou 'externo'
  // (marketplace/manual, só existe no Bling). Base do relatório de vendas COMPLETO:
  // receita total = Bling, não só site/WhatsApp.
  if (action === 'bling_sales_list') {
    const from = String(payload.from ?? '').trim();
    const to = String(payload.to ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return json({
        ok: false,
        error: 'periodo_invalido'
      }, 400);
    }
    const token = await getValidBlingToken(admin, 'tricopill');
    if (!token) return json({
      ok: false,
      error: 'bling_indisponivel'
    }, 502);
    const bh = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    };
    const orders = [];
    for(let page = 1; page <= 10; page++){
      const u = `https://api.bling.com.br/Api/v3/pedidos/vendas?pagina=${page}&limite=100&dataInicial=${from}&dataFinal=${to}`;
      const r = await fetch(u, {
        headers: bh
      });
      if (!r.ok) {
        if (page === 1) return json({
          ok: false,
          error: 'bling_pedidos_falhou',
          status: r.status
        }, 502);
        break;
      }
      const data = JSON.parse(await r.text() || '{}')?.data ?? [];
      orders.push(...data);
      if (data.length < 100) break;
      await new Promise((res)=>setTimeout(res, 350));
    }
    const ids = orders.map((o)=>String(o.id));
    const gatewayByOrder = new Map();
    if (ids.length) {
      for (const [table, gw] of [
        [
          'rede_payments',
          'rede'
        ],
        [
          'asaas_payments',
          'asaas'
        ]
      ]){
        const { data: pays } = await admin.from(table).select('bling_order_id').eq('tenant_id', 'tricopill').in('bling_order_id', ids);
        for (const p of pays ?? []){
          gatewayByOrder.set(String(p.bling_order_id), gw);
        }
      }
    }
    const items = orders.map((o)=>{
      const contato = o.contato ?? {};
      const situacao = o.situacao ?? {};
      const gw = gatewayByOrder.get(String(o.id)) ?? null;
      return {
        orderId: String(o.id),
        numero: String(o.numero ?? ''),
        date: String(o.data ?? ''),
        name: String(contato.nome ?? '').trim() || 'Cliente',
        totalCents: Math.round(Number(o.total ?? 0) * 100),
        canceled: Number(situacao.id ?? 0) === 12,
        viaCrm: gw != null,
        gateway: gw
      };
    });
    return json({
      ok: true,
      items
    });
  }
  // nfe_emit_order: emite a NF-e de UM pedido do Bling pelo id do PEDIDO (não exige venda no
  // CRM). CPF sai do contato do pedido. Grava o desfecho em bling_nfe_emissions e espelha em
  // rede_payments quando o pedido veio de uma venda do CRM (mantém /pedidos coerente).
  if (action === 'nfe_emit_order') {
    const orderId = String(payload.orderId ?? '').trim();
    if (!orderId) return json({
      ok: false,
      error: 'missing_order'
    }, 400);
    const recordOutcome = async (patch)=>{
      await admin.from('bling_nfe_emissions').upsert({
        tenant_id: 'tricopill',
        bling_order_id: orderId,
        emitted_at: new Date().toISOString(),
        ...patch
      }, {
        onConflict: 'tenant_id,bling_order_id'
      });
      await admin.from('rede_payments').update(patch).eq('tenant_id', 'tricopill').eq('bling_order_id', orderId);
    };
    // Já emitida? (por esta tela ou pela emissão antiga baseada em pagamento)
    const { data: prev } = await admin.from('bling_nfe_emissions').select('nfe_numero').eq('tenant_id', 'tricopill').eq('bling_order_id', orderId).maybeSingle();
    const prevNumero = prev?.nfe_numero;
    if (prevNumero) return json({
      ok: true,
      alreadyEmitted: true,
      numero: prevNumero
    });
    const { data: prevPay } = await admin.from('rede_payments').select('nfe_numero').eq('tenant_id', 'tricopill').eq('bling_order_id', orderId).not('nfe_numero', 'is', null).limit(1).maybeSingle();
    const prevPayNumero = prevPay?.nfe_numero;
    if (prevPayNumero) return json({
      ok: true,
      alreadyEmitted: true,
      numero: prevPayNumero
    });
    const { data: intRow2 } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', 'tricopill').maybeSingle();
    const bcfg2 = intRow2?.bling ?? {};
    const naturezaOperacaoId = String(bcfg2.natureza_operacao_id ?? '').trim();
    if (!naturezaOperacaoId) {
      return json({
        ok: false,
        error: 'natureza_nao_configurada',
        message: 'Configure a natureza de operação da NF-e antes de emitir.'
      }, 400);
    }
    const transmit = payload.transmit !== undefined ? payload.transmit === true : bcfg2.auto_nfe_transmit === true;
    const token = await getValidBlingToken(admin, 'tricopill');
    if (!token) return json({
      ok: false,
      error: 'bling_indisponivel'
    }, 502);
    const bh = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    // Pedido: contato, desconto, data e itens (mesmo caminho do nfe_emit por pagamento).
    let contatoId = '';
    let descontoReais = 0;
    let freteReais = 0;
    let fretePorConta = 1;
    let dataPedido = '';
    let itens = [];
    try {
      const gr = await blingGet(`https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`, bh);
      if (!gr.ok) {
        // 200 com ok:false (não 502) pra tela mostrar o motivo NA LINHA. Um 502 aqui vira
        // "Edge Function returned a non-2xx status code" e o operador fica sem saber de nada.
        const msg = `Não consegui ler o pedido no Bling (HTTP ${gr.status}). Tente de novo em alguns segundos.`;
        await recordOutcome({
          nfe_status: 'erro',
          nfe_error: msg
        });
        return json({
          ok: false,
          error: 'pedido_bling_nao_lido',
          message: msg
        });
      }
      const o = JSON.parse(await gr.text() || '{}')?.data ?? {};
      if (Number((o.situacao ?? {}).id ?? 0) === 12) {
        return json({
          ok: false,
          error: 'pedido_cancelado',
          message: 'Pedido cancelado no Bling não gera nota.'
        });
      }
      contatoId = String((o.contato ?? {}).id ?? '');
      descontoReais = Number((o.desconto ?? {}).valor ?? 0) || 0;
      freteReais = Number((o.transporte ?? {}).frete ?? 0) || 0;
      fretePorConta = Number((o.transporte ?? {}).fretePorConta ?? 1);
      dataPedido = String(o.data ?? '');
      itens = await buildNfeItens(Array.isArray(o.itens) ? o.itens : [], bh);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await recordOutcome({
        nfe_status: 'erro',
        nfe_error: msg.slice(0, 500)
      });
      return json({
        ok: false,
        error: 'pedido_bling_erro',
        message: msg
      });
    }
    if (!contatoId || itens.length === 0) return json({
      ok: false,
      error: 'pedido_sem_itens_ou_contato'
    }, 400);
    // CPF/CNPJ + nome: do contato do Bling (marketplace já traz; cadastro manual pode faltar).
    // Se o pedido veio do CRM, usa customer_name como fallback na montagem da NF-e.
    let contatoNomeCrm = '';
    try {
      const { data: payNome } = await admin.from('rede_payments').select('customer_name').eq('tenant_id', 'tricopill').eq('bling_order_id', orderId).limit(1).maybeSingle();
      contatoNomeCrm = String(payNome?.customer_name ?? '').trim();
    } catch  {}
    try {
      const cr = await blingGet(`https://api.bling.com.br/Api/v3/contatos/${contatoId}`, bh);
      if (!cr.ok) {
        const msg = `Não consegui ler o contato no Bling (HTTP ${cr.status}). Tente de novo em alguns segundos.`;
        await recordOutcome({
          nfe_status: 'erro',
          nfe_error: msg
        });
        return json({
          ok: false,
          error: 'contato_bling_nao_lido',
          message: msg
        });
      }
      const cd = JSON.parse(await cr.text() || '{}')?.data ?? {};
      const doc = String(cd.numeroDocumento ?? '').replace(/\D/g, '');
      if (doc.length !== 11 && doc.length !== 14) {
        const msg = 'Contato do pedido sem CPF/CNPJ no Bling. Complete o cadastro do contato e tente de novo.';
        await recordOutcome({
          nfe_status: 'erro',
          nfe_error: msg
        });
        return json({
          ok: false,
          error: 'sem_cpf',
          message: msg
        });
      }
      if (!String(cd.nome ?? '').trim() && !contatoNomeCrm) {
        const msg = 'Contato do pedido sem nome no Bling. Complete o cadastro do contato e tente de novo.';
        await recordOutcome({
          nfe_status: 'erro',
          nfe_error: msg
        });
        return json({
          ok: false,
          error: 'sem_nome',
          message: msg
        });
      }
    } catch (e) {
      return json({
        ok: false,
        error: 'contato_bling_erro',
        message: e instanceof Error ? e.message : String(e)
      }, 502);
    }
    try {
      const out = await blingEmitNfe(token, {
        naturezaOperacaoId,
        contatoId,
        itens,
        transmit,
        dataOperacaoISO: dataPedido ? `${dataPedido}T12:00:00-03:00` : undefined,
        descontoReais,
        freteReais,
        fretePorConta,
        contatoNome: contatoNomeCrm || undefined
      });
      const status = out.error ? 'erro' : out.transmitted ? 'emitida' : 'rascunho';
      await recordOutcome({
        nfe_id: out.nfeId,
        nfe_numero: out.numero ?? null,
        nfe_status: status,
        nfe_error: out.error ?? null
      });
      // `numero` volta junto: quando o rascunho nasce mas a TRANSMISSÃO falha, a nota já
      // existe no Bling. Sem devolver o número, o operador reemite e duplica o rascunho.
      if (out.error) {
        return json({
          ok: false,
          error: 'nfe_falhou',
          message: out.error,
          numero: out.numero ?? null
        });
      }
      return json({
        ok: true,
        nfeId: out.nfeId,
        numero: out.numero ?? null,
        status,
        transmitted: out.transmitted
      });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await recordOutcome({
        nfe_status: 'erro',
        nfe_error: msg
      });
      return json({
        ok: false,
        error: 'nfe_falhou',
        message: msg
      });
    }
  }
  /**
   * settle_open_receivables — baixa em LOTE as contas a receber que nasceram em aberto.
   *
   * Por que existe: `blingEnsureReceivable` cria a conta e, sem taxa da modalidade cadastrada
   * em `tenant_integrations.<gateway>.fees`, deixa EM ABERTO de propósito (nunca chuta taxa,
   * ver `_shared/gatewayFees.ts`). Como `credito_parcelado` nunca foi cadastrado, TODA venda
   * parcelada ficou aberta: 45 vendas e R$ 30.116,70 entre 01/jul e 19/ago/2026.
   *
   * No dia que a taxa for cadastrada, isto liquida o atrasado de uma vez. Idempotente:
   * pula quem já tem `bling_settled_at`, e a taxa continua vindo do `quoteGatewayFee` —
   * modalidade sem taxa cadastrada é PULADA, não chutada.
   *
   * Params: { since?: 'YYYY-MM-DD', dry?: bool (default TRUE), limit?: int, probe?: bool }
   * `dry` é o default de propósito: isto escreve em financeiro de produção.
   */
  if (action === 'settle_open_receivables') {
    const token = await getValidBlingToken(admin, tenantId);
    if (!token) return json({ ok: false, error: 'bling_sem_token' }, 400);
    const bh = { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' };
    const args = payload as Record<string, unknown>;
    const since = String(args.since ?? '2026-07-01').slice(0, 10);
    const dry = args.dry !== false;
    const limit = Math.max(1, Math.min(200, Number(args.limit ?? 50)));

    // Sondagem: devolve o formato cru de /contas/receber pra conferir campo e situação
    // antes de escrever qualquer baixa. Read-only.
    if (args.probe === true) {
      const r = await blingGet(`${'https://api.bling.com.br/Api/v3'}/contas/receber?pagina=1&limite=3`, bh);
      const txt = await r.text();
      let parsed = null;
      try { parsed = JSON.parse(txt || '{}'); } catch { /* devolve cru */ }
      return json({ ok: r.ok, status: r.status, sample: parsed ?? txt.slice(0, 800) });
    }

    const { data: rows } = await admin
      .from('rede_payments')
      .select('id, amount_cents, installments, method, bling_order_id, bling_receivable_id, bling_settled_at, paid_at, customer_name')
      .eq('tenant_id', tenantId).eq('status', 'paid').eq('method', 'card')
      .is('bling_settled_at', null).not('bling_order_id', 'is', null)
      .gte('paid_at', since + 'T00:00:00Z')
      .order('paid_at', { ascending: true }).limit(limit);

    const pend = rows ?? [];
    const out: {
      ok: boolean; dry: boolean; since: string; encontrados: number; baixados: number;
      pulados: Array<Record<string, unknown>>; erros: Array<Record<string, unknown>>; total_taxa_cents: number;
    } = { ok: true, dry, since, encontrados: pend.length, baixados: 0, pulados: [], erros: [], total_taxa_cents: 0 };

    for (const row of pend) {
      const fee = await quoteGatewayFee(admin, tenantId, 'rede', {
        method: row.method, installments: row.installments ?? 1, amountCents: row.amount_cents,
      });
      if (!fee) { out.pulados.push({ id: row.id, motivo: 'sem_taxa_cadastrada', parcelas: row.installments }); continue; }

      // Acha a conta: pelo id gravado, ou pelo nº do pedido (é o `numeroDocumento` que o
      // blingEnsureReceivable grava). O caminho do SITE não gravava o id até 19/08.
      let contaId = row.bling_receivable_id ? String(row.bling_receivable_id) : '';
      let numero = '';
      if (!contaId) {
        const pr = await blingGet(`${'https://api.bling.com.br/Api/v3'}/pedidos/vendas/${row.bling_order_id}`, bh);
        if (!pr.ok) { out.erros.push({ id: row.id, etapa: 'pedido', status: pr.status }); continue; }
        const pd = (JSON.parse((await pr.text()) || '{}').data ?? {});
        numero = String(pd.numero ?? '');
        if (!numero) { out.erros.push({ id: row.id, etapa: 'pedido_sem_numero' }); continue; }
        const cr = await blingGet(`${'https://api.bling.com.br/Api/v3'}/contas/receber?numeroDocumento=${encodeURIComponent(numero)}`, bh);
        if (!cr.ok) { out.erros.push({ id: row.id, etapa: 'busca_conta', status: cr.status }); continue; }
        const lista = (JSON.parse((await cr.text()) || '{}').data ?? []);
        // A busca pode ignorar o filtro e devolver tudo: casa pelo numeroDocumento de novo.
        const achou = (Array.isArray(lista) ? lista : []).find((c) => String(c.numeroDocumento ?? '') === numero);
        if (!achou) { out.pulados.push({ id: row.id, motivo: 'conta_nao_encontrada', numero }); continue; }
        contaId = String(achou.id ?? '');
        if (String(achou.situacao ?? '') === '2') { out.pulados.push({ id: row.id, motivo: 'ja_baixada', numero }); continue; }
      }
      if (!contaId) { out.pulados.push({ id: row.id, motivo: 'sem_conta' }); continue; }

      if (dry) {
        out.baixados++;
        out.total_taxa_cents += fee.feeCents;
        out.pulados.push({ id: row.id, motivo: 'dry_run', contaId, taxa_cents: fee.feeCents, liquido_cents: fee.netCents, pct: fee.pct });
        continue;
      }

      const dataISO = String(row.paid_at ?? '').slice(0, 10);
      const br = await fetch(`${'https://api.bling.com.br/Api/v3'}/contas/receber/${contaId}/baixar`, {
        method: 'POST', headers: bh,
        body: JSON.stringify({
          data: dataISO,
          valorPago: Math.round(row.amount_cents - fee.feeCents) / 100,
          juros: 0, desconto: 0, acrescimo: 0,
          tarifa: fee.feeCents / 100,
          historico: `Recebido líquido (taxa da adquirente ${fee.pct}% — ${fee.modality}) — baixa retroativa`.slice(0, 200),
        }),
      });
      if (!br.ok) { out.erros.push({ id: row.id, etapa: 'baixa', status: br.status, detalhe: (await br.text()).slice(0, 200) }); continue; }

      await admin.from('rede_payments').update({
        bling_receivable_id: contaId,
        bling_settled_at: new Date().toISOString(),
        fee_cents: fee.feeCents,
        net_cents: fee.netCents,
        fee_source: 'tabela',
      }).eq('id', row.id);
      out.baixados++;
      out.total_taxa_cents += fee.feeCents;
    }
    return json(out);
  }

  return json({
    error: 'unknown_action'
  }, 400);
});
