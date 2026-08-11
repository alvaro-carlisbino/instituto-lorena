import { defineConfig, devices } from '@playwright/test'

/**
 * Porta configurável por env.
 *
 * Motivo real: com duas sessões de trabalho abertas no mesmo repositório, a outra tinha um
 * `vite --port 5174` de pé SEM VITE_DATA_MODE=mock. Como reuseExistingServer é true fora de
 * CI, o Playwright adotou aquele servidor calado e a suíte inteira rodou contra o app em
 * modo real, sem permissão nenhuma: 4 testes falharam por motivo que não existia no código.
 *
 * Um servidor reaproveitado precisa ser o servidor certo. E2E_PORT permite subir o seu.
 */
const port = Number(process.env.E2E_PORT ?? 5174)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { ...process.env, VITE_DATA_MODE: 'mock' },
  },
})
