import { useEffect, useState } from 'react'

/** Relógio de referência para cálculos no cliente (evita `Date.now()` durante o render). */
export function useNowMs(updateIntervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), updateIntervalMs)
    return () => window.clearInterval(id)
  }, [updateIntervalMs])
  return now
}
