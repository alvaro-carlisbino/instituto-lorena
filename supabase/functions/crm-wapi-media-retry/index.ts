import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { createWapiProviderForRow, loadWapiInstanceByRowId } from '../_shared/whatsapp/wapiConfig.ts'
import { WapiProvider } from '../_shared/whatsapp/wapi.ts'
import { enrichMediaRowsFromBase64 } from '../_shared/manychatMediaEnrich.ts'
import { transcricaoEmEscritaErrada } from '../_shared/zaiAudioAsr.ts'

// Worker (cron, a cada 2 min) que reprocessa downloads de mídia inbound do W-API que
// FALHARAM no webhook. O áudio (PTT/opus) costuma estourar o timeout na hora da mensagem,
// e o webhook não pode esperar (limite de wall-clock da Edge). Aqui rodamos fora da
// requisição original, sem pressa, e gravamos em crm_media_items assim que conseguir baixar.
// Fila: crm_media_retry_jobs (enfileirada por crm-wapi-webhook). Os campos de descriptografia
// (mediaKey/directPath) NÃO expiram como o fileLink, então o retry tardio funciona.
// Auth: pg_cron chama com Bearer service_role (verify_jwt cobre).

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const MAX_ATTEMPTS = 6
const BATCH = 6
// Só inicia um novo job se ainda há folga — cada download pode levar ~1min e a Edge tem
// limite de wall-clock. O que sobrar fica pendente p/ o próximo tick (2 min).
const TIME_BUDGET_MS = 60_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const nowIso = () => new Date().toISOString()

  const { data: jobs, error } = await admin
    .from('crm_media_retry_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('next_attempt_at', nowIso())
    .order('next_attempt_at', { ascending: true })
    .limit(BATCH)
  if (error) return json({ error: 'query_failed', message: error.message }, 500)

  const start = Date.now()
  let done = 0
  let requeued = 0
  let failed = 0
  let skipped = 0

  for (const job of jobs ?? []) {
    if (Date.now() - start > TIME_BUDGET_MS) {
      skipped++
      continue
    }
    const attempts = Number(job.attempts ?? 0) + 1

    const requeue = async (errMsg: string, backoffMin: number) => {
      const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
      await admin
        .from('crm_media_retry_jobs')
        .update({
          status,
          attempts,
          last_error: errMsg.slice(0, 300),
          next_attempt_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
          updated_at: nowIso(),
        })
        .eq('id', job.id)
      attempts >= MAX_ATTEMPTS ? failed++ : requeued++
    }

    try {
      const row = await loadWapiInstanceByRowId(admin, String(job.whatsapp_instance_id ?? ''))
      if (!row) {
        await requeue('wapi_instance_not_found_or_inactive', 10)
        continue
      }
      const provider = createWapiProviderForRow(row) as unknown as WapiProvider
      const dl = await provider.downloadMedia(
        String(job.message_id),
        job.media_type as 'image' | 'audio' | 'video' | 'document',
        (job.media ?? {}) as Record<string, unknown>,
      )

      if (dl.ok && dl.base64) {
        const { data: inserted } = await admin
          .from('crm_media_items')
          .insert({
            lead_id: job.lead_id,
            interaction_id: job.interaction_id,
            tenant_id: job.tenant_id,
            direction: 'in',
            media_type: job.media_type,
            mime_type: dl.mimeType ?? null,
            media_base64: dl.base64,
            metadata: { source: 'wapi-retry', caption: job.caption ?? null },
          })
          .select('id')
          .single()
        // Enriquece (OCR/transcrição) p/ a IA enxergar a mídia — best-effort, não derruba o job.
        if (inserted?.id) {
          try {
            await enrichMediaRowsFromBase64(admin, { rowIds: [String(inserted.id)] })
          } catch (e) {
            console.warn('[wapi-media-retry] enrich failed:', e instanceof Error ? e.message : String(e))
          }
        }
        await admin
          .from('crm_media_retry_jobs')
          .update({ status: 'done', attempts, last_error: null, updated_at: nowIso() })
          .eq('id', job.id)
        // Cutuca o realtime de `leads` p/ o chat recarregar e exibir a mídia na hora
        // (em vez de esperar o poll de 12s). leads já está na publicação de realtime.
        await admin.from('leads').update({ updated_at: nowIso() }).eq('id', job.lead_id)
        done++
      } else {
        await requeue(String(dl.debug ?? 'download_failed'), Math.min(30, attempts * 3))
      }
    } catch (e) {
      await requeue(e instanceof Error ? e.message : String(e), 5)
    }
  }

  // === Reprocessa transcrição que voltou no idioma errado ===
  // O glm-asr ignora `language=pt` de vez em quando e devolve chinês. Até 11/ago/2026
  // isso era gravado direto em `transcribed_text`: 24 áudios de paciente viraram chinês
  // na ficha e no contexto da Sofia — inclusive "我明天做手术，知道怎么去那里吗？", que era
  // alguém perguntando como chegar para a cirurgia do dia seguinte.
  //
  // A guarda em `zaiAudioAsr.ts` impede casos novos, mas não desfaz o que já está gravado.
  // Como a falha é intermitente, reprocessar costuma acertar — e é a mesma natureza do
  // trabalho deste worker (mídia que falhou e merece outra chance), por isso vive aqui.
  //
  // Converge sozinho: limpamos o texto antes de reprocessar, então ou entra transcrição
  // boa, ou a guarda descarta e o campo fica nulo. Nos dois casos a linha sai do filtro
  // e não volta no próximo tick. Sem fila para manter, sem migração para rodar à mão.
  let retranscritos = 0
  let retranscricoesLimpas = 0
  if (Date.now() - start < TIME_BUDGET_MS) {
    try {
      // O filtro por regex fica em JS, não no PostgREST: a checagem é a MESMA função que
      // guarda a gravação (`transcricaoEmEscritaErrada`), então não há como as duas
      // divergirem com o tempo. São ~poucas dezenas de linhas de áudio com transcrição,
      // e o select não traz `media_base64` — o peso é desprezível.
      const { data: candidatos } = await admin
        .from('crm_media_items')
        .select('id, transcribed_text')
        .eq('media_type', 'audio')
        .not('transcribed_text', 'is', null)
        .not('media_base64', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500)
      const torto = ((candidatos ?? []) as Array<{ id: string; transcribed_text: string | null }>)
        .filter((r) => transcricaoEmEscritaErrada(String(r.transcribed_text ?? ''), 'pt'))
        .slice(0, 4)
      for (const r of torto) {
        const id = String(r.id)
        // Zera primeiro: `enrichMediaRowsFromBase64` pula linha que já tem texto.
        await admin.from('crm_media_items').update({ transcribed_text: null }).eq('id', id)
        await enrichMediaRowsFromBase64(admin, { rowIds: [id] })
        const { data: depois } = await admin
          .from('crm_media_items')
          .select('transcribed_text')
          .eq('id', id)
          .maybeSingle()
        if (String((depois as { transcribed_text?: string } | null)?.transcribed_text ?? '').trim()) {
          retranscritos++
        } else {
          retranscricoesLimpas++
        }
        if (Date.now() - start > TIME_BUDGET_MS) break
      }
    } catch (e) {
      console.warn('[wapi-media-retry] retranscrição falhou:', e instanceof Error ? e.message : String(e))
    }
  }

  return json({
    ok: true,
    picked: jobs?.length ?? 0,
    done,
    requeued,
    failed,
    skipped,
    retranscritos,
    retranscricoes_limpas: retranscricoesLimpas,
  })
})
