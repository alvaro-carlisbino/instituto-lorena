// Service Worker simples: cache-first pra assets estáticos + network-first pra
// chamadas Supabase/HTTP (não cacheia API). Atualiza automaticamente quando uma
// nova versão do app é deployada (skipWaiting + clients.claim).
//
// Limitações conscientes:
// - Não pré-cacheia rotas/JS chunks (Vite gera hashes — service worker simples
//   serve da rede). Isso significa que offline puro não funciona, mas o app
//   instalado abre instantaneamente quando online.
// - Não usa Workbox — manter dependência zero.

// v2: a v1 podia guardar uma página HTML sob a URL de um chunk .js (ver o fetch de
// assets abaixo). Trocar o nome faz o `activate` apagar o cache envenenado de quem já
// estava com o problema — é o que desfaz o erro sem pedir limpeza manual de cache.
// v3: só arquivo estático passa pelo cache-first (ver o fetch abaixo).
const CACHE = 'crm-app-v3'

/**
 * Pasta em que este SW está montado: "/" na raiz, "/interno/" quando o CRM roda dentro
 * da loja do Tricopill. Tudo aqui é relativo a ela.
 *
 * Com caminho fixo "/", o SW do CRM em subcaminho cacheava e servia a HOME DA LOJA como
 * fallback do app — a página de vendas aparecendo dentro do sistema interno.
 */
const BASE = new URL('./', self.location).pathname
const STATIC_ASSETS = [BASE, `${BASE}favicon.png`, `${BASE}favicon.svg`, `${BASE}manifest.webmanifest`]

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => undefined)),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Não cachear API/Supabase/auth — sempre rede.
  if (url.hostname.endsWith('.supabase.co') || url.pathname.startsWith('/api/')) {
    return
  }

  // HTML: network-first (pra pegar build novo); fallback offline pro cache.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Página de erro não serve de fallback offline.
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined)
          }
          return res
        })
        // Sem rede e sem cópia: `undefined` no respondWith vira outro erro no console.
        .catch(() =>
          caches
            .match(req)
            .then((cached) => cached || caches.match(BASE))
            .then((cached) => cached || Response.error()),
        ),
    )
    return
  }

  // Todo GET que não era página caía no cache-first abaixo, inclusive rota do app pedida por
  // fetch sem `accept: text/html` (em 17/set/2026 foi um `/ponto`). Nada disso é cacheado, e
  // uma falha de rede ali rejeitava o respondWith: "FetchEvent for .../ponto resulted in a
  // network error response" + "Uncaught (in promise) TypeError: Failed to fetch" no sw.js.
  // Só arquivo estático passa pelo SW; o resto vai direto à rede, como se ele não existisse.
  const ehAsset =
    url.pathname.startsWith(`${BASE}assets/`) || /\.(js|css|png|svg|webp|woff2?)$/.test(url.pathname)
  if (!ehAsset) return

  // Assets: cache-first com fallback rede.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached
      return fetch(req)
        .then((res) => {
          // `res.ok` NÃO basta. Quando um chunk com hash antigo some (deploy novo), o
          // rewrite do Vercel respondia a página com status 200 e `text/html` — a
          // condição antiga aceitava isso e GRAVAVA O HTML sob a URL do .js. Daí em
          // diante o cache-first servia HTML como script para sempre, e o erro
          // "Expected a JavaScript-or-Wasm module script" sobrevivia a qualquer reload.
          // Agora um asset só entra no cache se o tipo devolvido combinar com o pedido.
          const tipo = res.headers.get('content-type') || ''
          const pediuScript = /\.(js|mjs)$/.test(url.pathname) || url.pathname.startsWith(`${BASE}assets/`)
          const veioHtml = tipo.includes('text/html')

          if (res.ok && !(pediuScript && veioHtml)) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined)
          }
          return res
        })
        // Sem rede e fora do cache não há o que servir. Devolver o erro explícito evita a
        // rejeição solta; o import que falhar cai no src/lib/chunkReload.ts como antes.
        .catch(() => Response.error())
    }),
  )
})
