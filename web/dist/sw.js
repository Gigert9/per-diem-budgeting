/* eslint-disable no-restricted-globals */

const CACHE_PREFIX = 'budgetapp-cache-'
const CACHE_VERSION = 'v1'
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`

const toUrl = (path) => new URL(path, self.registration.scope).toString()

const CORE_ASSETS = [
  toUrl('./'),
  toUrl('./index.html'),
  toUrl('./favicon.ico'),
  toUrl('./manifest.webmanifest'),
  toUrl('./icons/icon-192.png'),
  toUrl('./icons/icon-512.png'),
  toUrl('./icons/apple-touch-icon.png')
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      await cache.addAll(CORE_ASSETS)
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  const isSameOrigin = url.origin === self.location.origin

  // App navigation: serve cached index.html offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME)
        const cached = await cache.match(toUrl('./index.html'))
        try {
          const fresh = await fetch(req)
          cache.put(toUrl('./index.html'), fresh.clone())
          return fresh
        } catch {
          return cached ?? Response.error()
        }
      })()
    )
    return
  }

  if (!isSameOrigin) return

  // Static assets: cache-first.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(req)
      if (cached) return cached
      const res = await fetch(req)
      if (res.ok) {
        cache.put(req, res.clone())
      }
      return res
    })()
  )
})
