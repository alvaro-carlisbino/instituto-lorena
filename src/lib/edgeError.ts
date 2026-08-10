/**
 * Extrai o motivo REAL de um erro de edge function.
 *
 * `FunctionsHttpError.context` é o `Response` cru, e `context.body` é um ReadableStream —
 * NUNCA uma string. O `typeof ctx.body === 'string'` que estava espalhado pelo repo dava
 * sempre falso, e todo erro não-2xx caía no `error.message` genérico do supabase-js: o
 * famoso "Edge Function returned a non-2xx status code" no lugar do motivo de verdade
 * ("o Bling recusou por X", "pluggy_get_failed /accounts: …"). O corpo precisa ser lido.
 *
 * Vale pra qualquer `supabase.functions.invoke`: se a mensagem na tela é genérica,
 * desconfie do front ANTES de caçar no backend — o motivo veio no corpo da resposta.
 */
export async function edgeErrorMessage(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: unknown }).context
  if (ctx instanceof Response) {
    try {
      const txt = await ctx.clone().text() // clone: o corpo só pode ser lido uma vez
      try {
        const p = JSON.parse(txt) as { message?: unknown; error?: unknown }
        if (p.message) return String(p.message)
        if (p.error) return String(p.error)
      } catch {
        /* corpo não é JSON — usa o texto puro */
      }
      if (txt.trim()) return txt.slice(0, 400)
    } catch {
      /* stream já consumido */
    }
  }
  return String((error as { message?: unknown }).message || fallback)
}
