/** Marca do produto. Sobrescreva com VITE_APP_NAME / VITE_APP_BADGE / VITE_APP_LOGO_MONOGRAM se necessário. */

const envName = import.meta.env.VITE_APP_NAME as string | undefined
const envBadge = import.meta.env.VITE_APP_BADGE as string | undefined
const envMonogram = import.meta.env.VITE_APP_LOGO_MONOGRAM as string | undefined

export const APP_NAME = (envName?.trim() || 'Instituto Lorena · Gestão de Atendimento').trim()
export const APP_ENV_BADGE = (envBadge?.trim() || 'INTERNO').trim()
export const APP_LOGO_MONOGRAM = (envMonogram?.trim() || 'IL').trim().slice(0, 3).toUpperCase()

/** Subtítulo curto na sidebar (linha secundária). */
export const APP_TAGLINE = 'Atendimento ao Paciente'

/** Título da aba do navegador. */
export const APP_DOCUMENT_TITLE = `${APP_NAME} · ${APP_ENV_BADGE}`

/** Nome exibido no painel TV (linha principal). */
export const APP_TV_HEADING = APP_NAME
