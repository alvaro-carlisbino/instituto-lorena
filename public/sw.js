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
const CACHE = 'crm-app-v2'
const STATIC_ASSETS = ['/', '/favicon.png', '/favicon.svg', '/manifest.webmanifest']

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
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined)
          return res
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/'))),
    )
    return
  }

  // Assets: cache-first com fallback rede.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached
      return fetch(req).then((res) => {
        const ehAsset =
          url.pathname.startsWith('/assets/') || url.pathname.match(/\.(js|css|png|svg|webp|woff2?)$/)

        // `res.ok` NÃO basta. Quando um chunk com hash antigo some (deploy novo), o
        // rewrite do Vercel respondia a página com status 200 e `text/html` — a
        // condição antiga aceitava isso e GRAVAVA O HTML sob a URL do .js. Daí em
        // diante o cache-first servia HTML como script para sempre, e o erro
        // "Expected a JavaScript-or-Wasm module script" sobrevivia a qualquer reload.
        // Agora um asset só entra no cache se o tipo devolvido combinar com o pedido.
        const tipo = res.headers.get('content-type') || ''
        const pediuScript = /\.(js|mjs)$/.test(url.pathname) || url.pathname.startsWith('/assets/')
        const veioHtml = tipo.includes('text/html')

        if (res.ok && ehAsset && !(pediuScript && veioHtml)) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined)
        }
        return res
      })
    }),
  )
})
