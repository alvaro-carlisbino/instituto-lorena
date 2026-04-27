/**
 * Resolves the Evolution instance name from the webhook payload.
 */
export function extractEvolutionInstanceNameFromPayload(payload: Record<string, unknown>): string {
  const safe = (v: unknown) => (v == null ? '' : String(v).trim())
  const data = payload['data']
  return (
    safe(payload['instance']) ||
    (typeof data === 'object' && data && !Array.isArray(data)
      ? safe((data as Record<string, unknown>)['instanceName']) ||
        safe((data as Record<string, unknown>)['instance']) ||
        ''
      : '') ||
    ''
  )
}
