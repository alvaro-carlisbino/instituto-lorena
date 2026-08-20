import { useId } from 'react'

/**
 * Os desenhos da escala de calvície da landing.
 *
 * Existe porque pergunta escrita ("qual o seu grau de Norwood?") faz a pessoa
 * desistir: ninguém sabe o próprio grau, e quem sabe erra. Vista de cima, com a
 * falha desenhada, a escolha vira reconhecimento e não conhecimento. É a mesma
 * escala que a clínica usa na avaliação, então o que a pessoa marca aqui já serve
 * para a equipe se preparar antes de ela sentar na cadeira.
 *
 * O desenho é geométrico de propósito: dois recuos frontais (que formam o M) e uma
 * coroa que cresce. Nada de foto de banco de imagem, que envelhece e não é da casa.
 */

const CABELO = '#252A33'
const COURO = '#DCDBD1'
const CONTORNO = '#252A33'

type Estagio = { frente: number; coroa: number }

/** frente/coroa vão de 0 (cheio) a ~1,1 (só a ferradura das laterais). */
const NORWOOD: Record<string, Estagio> = {
  '1': { frente: 0.02, coroa: 0 },
  '2': { frente: 0.2, coroa: 0 },
  '3': { frente: 0.45, coroa: 0 },
  '3v': { frente: 0.45, coroa: 0.45 },
  '4': { frente: 0.6, coroa: 0.62 },
  '5': { frente: 0.72, coroa: 0.78 },
  '6': { frente: 0.9, coroa: 0.95 },
  '7': { frente: 1.05, coroa: 1.15 },
}

/** Ludwig: a perda feminina abre o risco no meio e desce pela coroa. */
const LUDWIG: Record<string, number> = {
  ludwig_1: 0.25,
  ludwig_2: 0.55,
  ludwig_3: 0.9,
}

export function EscalaCapilar({ grau, tamanho = 76 }: { grau: string; tamanho?: number }) {
  const id = useId().replace(/:/g, '')
  const clip = `cabeca-${id}`
  const ludwig = LUDWIG[grau]
  const estagio = NORWOOD[grau]
  const altura = Math.round(tamanho * 1.18)

  return (
    <svg
      width={tamanho}
      height={altura}
      viewBox="0 0 100 120"
      role="img"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <clipPath id={clip}>
          <ellipse cx="50" cy="60" rx="33" ry="46" />
        </clipPath>
      </defs>

      {/* cabeça cheia de cabelo; a falha é desenhada por cima */}
      <ellipse cx="50" cy="60" rx="33" ry="46" fill={CABELO} />

      <g clipPath={`url(#${clip})`}>
        {estagio ? (
          <>
            {/* a linha do cabelo inteira anda para trás */}
            <ellipse cx="50" cy="0" rx="34" ry={6 + estagio.frente * 26} fill={COURO} />
            {/* e as têmporas andam mais que o meio: é isso que desenha o M */}
            <ellipse cx="22" cy="6" rx="15" ry={8 + estagio.frente * 42} fill={COURO} />
            <ellipse cx="78" cy="6" rx="15" ry={8 + estagio.frente * 42} fill={COURO} />
            {estagio.coroa > 0 ? <circle cx="50" cy="86" r={estagio.coroa * 27} fill={COURO} /> : null}
          </>
        ) : null}

        {ludwig ? (
          <>
            {/* risco central que abre */}
            <ellipse cx="50" cy="52" rx={4 + ludwig * 20} ry={28 + ludwig * 12} fill={COURO} />
            {ludwig > 0.7 ? <circle cx="50" cy="78" r={ludwig * 18} fill={COURO} /> : null}
          </>
        ) : null}
      </g>

      <ellipse cx="50" cy="60" rx="33" ry="46" fill="none" stroke={CONTORNO} strokeWidth="1.5" opacity="0.35" />
      {/* orelhas, só para a pessoa entender que está vendo a cabeça de cima */}
      <path d="M17 55 q-6 5 0 12" fill="none" stroke={CONTORNO} strokeWidth="1.5" opacity="0.35" />
      <path d="M83 55 q6 5 0 12" fill="none" stroke={CONTORNO} strokeWidth="1.5" opacity="0.35" />
    </svg>
  )
}
