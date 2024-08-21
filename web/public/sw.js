// sw.js

// Version identifier for cache and update management
const cacheVersion = `O2-cache-v23`;
// Function to fetch the asset manifest
async function fetchManifest() {
  const response = await fetch("/web/manifest.json");
  return response.json();
}
self.addEventListener("install", function (event) {
  event.waitUntil(
    (async () => {
      const manifest = await fetchManifest();

      // List of files to cache
      const filesToCache = [];

      Object.keys(manifest).forEach((key) => {
        if (key == "index.html") {
          filesToCache.push("/web/");
          filesToCache.push("/web/favicon.ico");
          filesToCache.push(`/web/${manifest[key]["file"]}`);
          filesToCache.push("/web/sw.js");
        }
        if (
          typeof manifest[key] == "object" &&
          manifest[key]?.file &&
          manifest[key]?.file.indexOf(".js") > -1
        ) {
          filesToCache.push(`/web/${manifest[key]["file"]}`);
          filesToCache.push("/web/sw.js");
        }
        if (
          typeof manifest[key] == "object" &&
          manifest[key]?.file &&
          manifest[key]?.file.indexOf(".js") > -1
        ) {
          filesToCache.push(`/web/assets/${manifest[key]["file"]}`);
        }
      });

      // Open the cache
      const cache = await caches.open(cacheVersion);

      // Fetch and cache the files
      await Promise.all(
        filesToCache.map(async (file) => {
          try {
            const response = await fetch(file);
            if (!response.ok) {
              throw new Error(
                `Request for ${file} failed with status ${response.status}`
              );
            }
            console.log(file, "added to cache with a res", response.clone());


            await cache.put(file, response.clone());
          } catch (error) {
            console.error(`Failed to cache ${file}:`, error);
          }
        })
      );

      // self.skipWaiting(); // Uncomment if you want the SW to take control immediately
    })()
  );
});


self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(cacheName) {
          // Check if cacheName starts with the cacheVersion or contains it as part of the name
          return !cacheName.startsWith(cacheVersion);
        }).map(function(cacheName) {
          console.log('Deleting cache:', cacheName); // Debug: Log cache being deleted
          return caches.delete(cacheName);
        })
      );
    }).then(function() {
      // Claim clients immediately for the updated service worker
      return self.clients.claim();
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

  self.addEventListener("fetch", function (event) {
    console.log(event.request,"event request")
    caches
        .open(cacheVersion).then(function (cache) {
          console.log(cache,"cache")
        })
    
    event.respondWith(
      caches
        .open(cacheVersion).then(function (cache) {
          console.log("event.request", event.request);
          console.log("cache", cache);
          return cache.match(event.request);
        })
        .then(function (response) {
          if (response) {
            console.log(response,"res in fetch")
            return response.clone();
          }
          console.log(event.request, "event.request 2 in fetch");
          var fetchRequest = event.request;
          return fetch(fetchRequest)
            .then(function (response) {
              console.log("response", JSON.stringify(response));
              if (
                !response ||
                response.status !== 200 ||
                response.type !== "basic"
              ) {
                let staleFlag = false;
                self.clients.matchAll().then((clients) => {
                  clients.forEach((client) => {
                    console.log("client", JSON.stringify(client));
                    if (event.request.url.endsWith('.js')) {
                      staleFlag = true;
                      if (staleFlag) {
                        // self.skipWaiting();
                        // caches.delete("cache-name");
                        client.postMessage("staledata");
                      }
                    }
                  });
                });
                console.log(response, "res 2 in fetch");
                return response;
              }
              if (event.request.method === 'POST') {
                // Do not cache POST requests
                event.respondWith(
                  fetch(event.request).catch(function(error) {
                    console.error('Fetch failed:', error);
                    throw error;
                  })
                );
                return;
              }
              var responseToCache = response.clone();
              console.log(responseToCache, "res 3 in fetch");
              caches
                .open(cacheVersion)
                .then(function (cache) {
                  cache
                    .put(event.request, responseToCache)
                    .catch(function (error) {
                      console.error("Cache put failed:", error);
                    });
                })
                .catch(function (error) {
                  console.error("Cache open failed:", error);
                });
              return response;
            })
            .catch(function (error) {
              console.error("Fetch failed:", error);
              throw error;
            });
        })
        .catch(function (error) {
          console.error("Caches match failed:", error);
          throw error;
        }),
    );
  });

self.addEventListener("message", function (event) {
  console.log(event.data);
  if (event.data === "skipWaiting") {
    caches.delete(cacheVersion);
    self.skipWaiting();
  }
});
