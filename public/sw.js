// sw.js (Service Worker para PWA - La 51)

const CACHE_NAME = 'mutijuego-v1.12.27'; // Actualizado: Fix - no iniciar timeout de inactividad si jugador ya fue eliminado al desconectarse
const urlsToCache = [
  '/',
  '/index.html',
  '/select.html',
  '/la51/la51index.html',
  '/la51/la51game.js',
  '/la51/la51style.css',
  '/ludo/ludoindex.html',
  '/ludo/ludolobby.js',
  '/ludo/ludostyle.css',
  '/ludo/ludo.html',
  '/ludo/ludo-client.js',
  '/ludo/ludo.css',
  '/admin/la51admin.html',
  '/Angelohh.png'
];

// Instalar Service Worker
self.addEventListener('install', (event) => {
  console.log('Service Worker: Instalando nueva versión...');
  // Forzar actualización inmediata saltando la fase de espera
  event.waitUntil(
    Promise.all([
      // Limpiar caches antiguos primero
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log('Service Worker: Eliminando cache antiguo:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Cachear nuevos archivos
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Cacheando archivos');
        // Cachear archivos uno por uno para no bloquear si alguno falla
        return Promise.allSettled(
          urlsToCache.map(url => 
            cache.add(url).catch(err => {
              console.warn(`Service Worker: No se pudo cachear ${url}:`, err);
              return null; // Continuar aunque falle
            })
          )
        );
        })
    ]).then(() => {
      // Activar inmediatamente sin esperar
      return self.skipWaiting();
      })
      .catch((error) => {
      console.error('Service Worker: Error durante instalación:', error);
      // Aún así, activar para no bloquear
      return self.skipWaiting();
      })
  );
});

// Activar Service Worker
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activando nueva versión...');
  event.waitUntil(
    Promise.all([
      // Limpiar caches antiguos
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('Service Worker: Eliminando cache antiguo:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Tomar control de clientes SIN forzar recarga automática
      self.clients.claim().then(() => {
        // Verificar clientes y notificar solo si NO están en partidas activas
        return self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
          clients.forEach(client => {
            // Solo notificar si NO está en una partida activa
            const url = client.url || '';
            const isInActiveGame = url.includes('/ludo-game') || url.includes('/la51game') || url.includes('/la51-game');
            
            if (!isInActiveGame) {
              // Solo notificar, NO forzar recarga
              client.postMessage({
                type: 'SW_UPDATED',
                message: 'Nueva versión disponible.',
                action: 'notify' // El cliente decidirá si recargar
              });
            } else {
              console.log('Service Worker: Cliente en partida activa, no se notifica actualización:', url);
            }
          });
        });
      })
    ])
  );
});

// Interceptar requests
self.addEventListener('fetch', (event) => {
  // Solo interceptar requests GET
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  const pathname = url.pathname;
  
  // NO interceptar NADA relacionado con /select, /la51, /ludo para evitar demoras en móviles
  // Esto incluye navegaciones Y recursos estáticos (scripts, CSS, etc.)
  // Siempre obtener la versión más reciente del servidor (network-first)
  if (pathname === '/select' || 
      pathname.startsWith('/la51') || 
      pathname.startsWith('/ludo') ||
      pathname === '/sw.js') { // También el service worker mismo
    return; // Dejar que todas estas solicitudes vayan directamente a la red
  }

  // Para otros archivos estáticos, usar cache primero
  if (event.request.destination === 'document' || 
      event.request.destination === 'script' || 
      event.request.destination === 'style' ||
      event.request.destination === 'image') {
    
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          // Si está en cache, devolverlo
          if (response) {
            return response;
          }
          
          // Si no está en cache, hacer fetch y cachear
          return fetch(event.request).then((response) => {
            // Verificar que la respuesta es válida
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clonar la respuesta
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          }).catch(() => {
            // Si falla el fetch y es un documento, devolver index.html
            if (event.request.destination === 'document') {
              return caches.match('/index.html');
            }
          });
        })
    );
  }
});

// Manejar mensajes del cliente
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting().then(() => {
      // Notificar al cliente que se activó
      event.ports && event.ports[0] && event.ports[0].postMessage({ type: 'SKIP_WAITING_DONE' });
    });
  }
});

// Notificar actualizaciones
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/')
  );
});

