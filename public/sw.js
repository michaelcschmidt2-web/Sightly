// Sightly beta intentionally disables service-worker caching.
// This file stays at /sw.js so existing installed workers can update, clear
// stale caches, release controlled pages, and unregister themselves.

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(Promise.resolve())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.caches) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }

    if (self.registration) {
      await self.registration.unregister()
    }

    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    clientsList.forEach((client) => client.navigate(client.url))
  })())
})

self.addEventListener('fetch', () => {
  // Do not intercept requests during beta. Network/Vercel should serve the
  // latest index.html and hashed Vite assets directly.
})
