// Service Worker simples: cache-first pra assets estáticos + network-first pra
// chamadas Supabase/HTTP (não cacheia API). Atualiza automaticamente quando uma
// nova versão do app é deployada (skipWaiting + clients.claim).
//
// Limitações conscientes:
// - Não pré-cacheia rotas/JS chunks (Vite gera hashes — service worker simples
//   serve da rede). Isso significa que offline puro não funciona, mas o app
//   instalado abre instantaneamente quando online.
// - Não usa Workbox — manter dependência zero.

const CACHE = 'crm-app-v1'
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
        if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.match(/\.(js|css|png|svg|webp|woff2?)$/))) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined)
        }
        return res
      })
    }),
  )
})
