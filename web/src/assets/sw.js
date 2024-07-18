// sw.js

// Version identifier for cache and update management
const cacheVersion = 'v'+new Date().getTime().toString();
// Function to fetch the asset manifest
async function fetchManifest() {
  const response = await fetch('/web/src/assets/workers/manifest.json');
  return response.json();
}
self.addEventListener('install', function(event) {
  event.waitUntil(
    (async () => {
      // const cache = await caches.open(cacheVersion);
      const manifest = await fetchManifest();

      // List of files to cache
      const filesToCache = [
      ];

      // Add hashed filenames from the manifest
      Object.keys(manifest).forEach(key => {
        if(key == "index.html") {
          filesToCache.push("/web/");
          filesToCache.push("/web/index.html");
          filesToCache.push("/web/favicon.ico");
          filesToCache.push(`/web/${manifest[key]["file"]}`);
          filesToCache.push("/web/assets/sw.js");
        }
      });

      console.log(filesToCache);
      const cache = await caches.open(cacheVersion)
      .then((cache) => {
        try {
          cache.addAll(filesToCache);
        } catch (error) {
          console.error(`Failed to cache ${file}:`, error);
        }
      });
      // await cache.addAll(filesToCache);
      // Cache files with error handling
      self.skipWaiting();
      // await Promise.all(
      //   filesToCache.map(async (file) => {
      //     try {
      //       const response = await fetch(file);
      //       if (!response.ok) {
      //         throw new Error(`Request for ${file} failed with status ${response.status}`);
      //       }
      //       await cache.put(file, response);
      //     } catch (error) {
      //       console.error(`Failed to cache ${file}:`, error);
      //     }
      //   })
      // );
    })()
  );
});

self.addEventListener('activate', function(event) {
  // Clean up old caches if any
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(cacheName) {
          return cacheName !== cacheVersion;
        }).map(function(cacheName) {
          return caches.delete(cacheName);
        })
      );
    })
  );
});

// self.addEventListener('fetch', function(event) {
//   // Intercept fetch requests and serve from cache if available
//   event.respondWith(
//     caches.match(event.request).then(function(response) {
//       return response || fetch(event.request);
//     })
//   );
// });

self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request).then(function(response) {
      if (response) {
        return response;
      }
      var fetchRequest = event.request;
      return fetch(fetchRequest).then(function(response) {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        var responseToCache = response.clone();
        caches.open('cache-name').then(function(cache) {
          cache.put(event.request, responseToCache).catch(function(error) {
            console.error('Cache put failed:', error);
          });
        }).catch(function(error) {
          console.error('Cache open failed:', error);
        });
        return response;
      }).catch(function(error) {
        console.error('Fetch failed:', error);
        throw error;
      });
    }).catch(function(error) {
      console.error('Caches match failed:', error);
      throw error;
    })
  );
});

self.addEventListener('message', function(event) {
  console.log(event.data)
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});