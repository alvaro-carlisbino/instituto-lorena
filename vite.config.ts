import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { type Plugin, defineConfig } from 'vite'

/**
 * Caminho onde o app é servido. Vazio (padrão) = raiz do domínio.
 *
 * O CRM do Tricopill roda DENTRO da loja, em tricopill.com.br/interno, para não pedir
 * domínio novo nem registro de DNS. Servir sob subcaminho exige que TRÊS coisas concordem:
 * o `base` daqui (para os assets saírem em /interno/assets/…), o `basename` do router e o
 * escopo do service worker. Se uma delas discordar, a tela abre em branco.
 */
const BASE_PATH = (process.env.VITE_BASE_PATH ?? '').trim()

/**
 * Publica `src/config/notasDaVersao.json` como `notas-da-versao.json` na raiz do app.
 *
 * A aba aberta precisa ler as notas do servidor (as do deploy NOVO), não as do próprio bundle,
 * para contar o que mudou antes de a pessoa atualizar. Sai da mesma fonte que o app importa,
 * então não existe segunda cópia para esquecer de editar.
 * - build: vira asset com nome fixo, sem hash, na raiz do `dist/`. O `base` não muda a pasta do
 *   build (só as URLs no HTML), e o rewrite `/interno/:path*` da loja já tira o prefixo.
 * - dev: responde em `${base}notas-da-versao.json`, relendo o arquivo a cada pedido.
 * JSON inválido ou nota malformada quebra o build de propósito: melhor do que publicar um
 * aviso vazio sem ninguém perceber.
 */
function notasDaVersao(): Plugin {
  const fonte = path.resolve(__dirname, 'src/config/notasDaVersao.json')
  const nomeArquivo = 'notas-da-versao.json'
  const ler = () => {
    const notas = JSON.parse(fs.readFileSync(fonte, 'utf8'))
    if (!Array.isArray(notas)) throw new Error(`${fonte}: esperado uma lista de notas`)
    notas.forEach((n, i) => {
      const ok =
        n &&
        typeof n.id === 'string' &&
        n.id !== '' &&
        typeof n.titulo === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(n.data) &&
        Array.isArray(n.itens) &&
        n.itens.every((t: unknown) => typeof t === 'string')
      if (!ok) throw new Error(`${fonte}, nota ${i + 1}: precisa de id, data (AAAA-MM-DD), titulo e itens`)
    })
    return JSON.stringify(notas)
  }
  let base = '/'
  return {
    name: 'crm-notas-da-versao',
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== `${base}${nomeArquivo}`) return next()
        try {
          const corpo = ler()
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(corpo)
        } catch (err) {
          next(err)
        }
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: nomeArquivo, source: ler() })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: BASE_PATH ? `${BASE_PATH.replace(/\/+$/, '')}/` : '/',
  plugins: [react(), tailwindcss(), notasDaVersao()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@assets': path.resolve(__dirname, './assets'),
    },
  },
  build: {
    // Vendors estáveis em chunks próprios: mudam raramente → o navegador cacheia entre
    // deploys (o hash só muda quando a lib muda, não a cada release do app).
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts'
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('react-router')) return 'vendor-react'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'vendor-react'
          return undefined
        },
      },
    },
    // Aviso de chunk >800KB ainda vale a atenção; abaixo disso é ruído com code-splitting.
    chunkSizeWarningLimit: 800,
  },
})
