import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// ─────────────────────────────────────────────────────────────────────────────
// Agenda cirúrgica como calendário assinável (iCalendar / .ics).
//
// Por que assim e não pela API do Google: escrever na agenda deles exige OAuth
// da conta da clínica, que não temos. Um feed .ics resolve hoje, sem credencial
// nenhuma: no Google Agenda, "Outras agendas" > "Da URL", cola o endereço uma
// vez e pronto. Toda cirurgia marcada na Central de Vendas passa a aparecer lá,
// e remarcação e cancelamento acompanham, porque o UID é o id da venda.
//
// A contrapartida honesta: o Google decide de quanto em quanto tempo relê a URL
// (costuma levar algumas horas, pode chegar a um dia). Para a cirurgia que
// acabou de ser marcada e precisa aparecer agora, a tela tem o botão que cria o
// evento na hora.
//
// SEGURANÇA: a URL carrega nome de paciente e procedimento. É protegida por um
// token no query string, guardado em app_cron_secrets (chave 'ics_cirurgias').
// Quem tiver a URL vê a agenda, então ela não vai para grupo de WhatsApp.
// ─────────────────────────────────────────────────────────────────────────────

const TZ = 'America/Sao_Paulo'

function icsEscape(v: string): string {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** iCalendar exige linha de no máximo 75 octetos, dobrada com espaço. */
function fold(line: string): string {
  const out: string[] = []
  let atual = line
  while (atual.length > 73) {
    out.push(atual.slice(0, 73))
    atual = ' ' + atual.slice(73)
  }
  out.push(atual)
  return out.join('\r\n')
}

const stampUtc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !serviceRole) return new Response('server_misconfigured', { status: 500 })
  const admin = createClient(url, serviceRole)

  const token = new URL(req.url).searchParams.get('t') ?? ''
  const { data: segredo } = await admin
    .from('app_cron_secrets')
    .select('secret')
    .eq('key', 'ics_cirurgias')
    .maybeSingle()
  const esperado = String((segredo as { secret?: string } | null)?.secret ?? '')
  if (!esperado || token !== esperado) {
    return new Response('não autorizado', { status: 401 })
  }

  // Janela: 120 dias para trás (histórico recente) e tudo que está por vir.
  const desde = new Date(Date.now() - 120 * 86400000).toISOString()
  const { data, error } = await admin
    .from('clinic_sales')
    .select('id, patient_name, procedure_label, scheduled_at, duration_minutes, performing_doctor, anesthetist, room, status, updated_at, city, hotel_needed')
    .eq('kind', 'cirurgia')
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', desde)
    .order('scheduled_at', { ascending: true })
  if (error) return new Response(error.message, { status: 500 })

  const linhas: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Instituto Lorena//Agenda Cirurgica//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Cirurgias · Instituto Lorena',
    `X-WR-TIMEZONE:${TZ}`,
    // Sugere ao cliente reler de hora em hora. O Google trata como dica, não ordem.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ]

  for (const r of data ?? []) {
    const row = r as Record<string, unknown>
    const inicio = new Date(String(row.scheduled_at))
    const minutos = Number(row.duration_minutes ?? 0) > 0 ? Number(row.duration_minutes) : 480
    const fim = new Date(inicio.getTime() + minutos * 60000)
    const equipe = [row.performing_doctor, row.anesthetist].filter(Boolean).join(' · ')
    const extras = [
      equipe ? `Equipe: ${equipe}` : '',
      row.city ? `Cidade do paciente: ${row.city}` : '',
      row.hotel_needed === true ? 'Precisa de hotel' : '',
      'Lançado pela Central de Vendas do CRM.',
    ].filter(Boolean).join('\n')

    linhas.push(
      'BEGIN:VEVENT',
      `UID:cirurgia-${row.id}@institutolorena`,
      `DTSTAMP:${stampUtc(new Date(String(row.updated_at ?? row.scheduled_at)))}`,
      `DTSTART:${stampUtc(inicio)}`,
      `DTEND:${stampUtc(fim)}`,
      fold(`SUMMARY:${icsEscape(`Cirurgia: ${row.patient_name} (${row.procedure_label})`)}`),
      fold(`DESCRIPTION:${icsEscape(extras)}`),
      row.room ? fold(`LOCATION:${icsEscape(String(row.room))}`) : 'LOCATION:Instituto Lorena Visentainer',
      `STATUS:${row.status === 'cancelada' ? 'CANCELLED' : 'CONFIRMED'}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    )
  }
  linhas.push('END:VCALENDAR')

  return new Response(linhas.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="cirurgias-instituto-lorena.ics"',
      'Cache-Control': 'public, max-age=900',
    },
  })
})
