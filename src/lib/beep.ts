/** Beep curto de confirmação (agudo) ou de erro (grave): feedback de bipagem sem olhar pra tela. */
export function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = ok ? 1400 : 260
    gain.gain.value = 0.08
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + (ok ? 0.09 : 0.25))
    osc.onended = () => void ctx.close()
  } catch {
    /* sem áudio, segue o jogo */
  }
  try {
    // No celular a vibração avisa mesmo com o som desligado.
    navigator.vibrate?.(ok ? 30 : [60, 40, 60])
  } catch {
    /* sem vibração */
  }
}
