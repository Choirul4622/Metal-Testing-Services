/**
 * SERVICE WORKER FOR OFFLINE-FIRST ARCHITECTURE
 * Cek Kadar Logam Sovia Jewelry
 */

const CACHE_NAME = "cekkadar-sovia-cache-v1";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "https://soviajewelry.com/wp-content/uploads/2021/12/logo-sovia-gold.png"
];

// Install Event - Cache assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log("[Service Worker] Caching app shell static assets...");
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event - Clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log("[Service Worker] Menghapus cache usang:", cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Stale While Revalidate / Cache First Strategy
self.addEventListener("fetch", (event) => {
  // Hanya intercept GET request (tidak mendukung HTTP POST untuk cache)
  if (event.request.method !== "GET") {
    return;
  }

  // Hindari caching request untuk API Google Apps Script
  if (event.request.url.includes("script.google.com")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Lakukan network fetch di background untuk memperbarui cache (Stale-While-Revalidate)
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          })
          .catch((err) => console.log("[Service Worker] Gagal refresh asset background:", err));
        
        return cachedResponse;
      }
      
      // Jika tidak ada di cache, lakukan fetch ke jaringan
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        
        // Cache response baru secara dinamis
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        
        return response;
      });
    })
  );
});
