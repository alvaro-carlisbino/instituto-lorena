/**
 * Foto de perfil do WhatsApp do contato (17/set/2026). O link vem no próprio webhook da W-API e é
 * guardado em `leads.custom_fields.wa_foto` a cada mensagem. Ele expira em algumas semanas, e
 * quem tem privacidade ligada não manda foto: quando não carrega, cai nas iniciais de sempre.
 */
export function fotoDoContato(customFields: Record<string, unknown> | undefined | null): string | null {
  const url = customFields?.wa_foto
  return typeof url === 'string' && url.startsWith('https://') ? url : null
}
