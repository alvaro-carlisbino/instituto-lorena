import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Testes de unidade das regras puras (rótulo de sessão, normalização, cálculo).
 *
 * `exclude` do e2e é obrigatório: o Playwright também mora em .spec.ts e, sem isso, o
 * Vitest tenta rodar os testes de browser e quebra com erro que não diz nada.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@assets': path.resolve(__dirname, './assets'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**', '.claude/**'],
  },
})
