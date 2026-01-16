// service-worker.js
// Update-friendly PWA cache:
// - New SW activates immediately (skipWaiting + clients.claim)
// - HTML: network-first (so new index loads)
// - JS/CSS: stale-while-revalidate (fast, but updates in background)
// - Everything else: cache-first

const CACHE_VERSION = "v6"; // <-- bump this when you want to force-refresh everything
const CACHE_NAME = `pooltest-cache-${CACHE_VERSION}`;

const ASSETS = [
    "./",
    "./index.html",
    "./css/pooltest.css",
    "./js/scanner.js",
    "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting(); // ✅ activate new SW immediately
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
        await self.clients.claim(); // ✅ take control without requiring a full restart
    })());
});

// Helpers
function isHTML(req) {
    return req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
}
function isJSorCSS(url) {
    return url.pathname.endsWith(".js") || url.pathname.endsWith(".css");
}

// Strategies
async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const fresh = await fetch(request, { cache: "no-store" });
        cache.put(request, fresh.clone());
        return fresh;
    } catch {
        const cached = await cache.match(request);
        return cached || caches.match("./index.html");
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    const fetchPromise = fetch(request).then((resp) => {
        cache.put(request, resp.clone());
        return resp;
    }).catch(() => null);

    return cached || (await fetchPromise) || Response.error();
}

async function cacheFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    const resp = await fetch(request);
    cache.put(request, resp.clone());
    return resp;
}

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);

    // Only handle same-origin requests (avoid caching cdn/jsdelivr etc.)
    if (url.origin !== self.location.origin) return;

    if (isHTML(req)) {
        // ✅ Always try to get the newest HTML
        event.respondWith(networkFirst(req));
        return;
    }

    if (isJSorCSS(url)) {
        // ✅ Fast load, but updates itself in background
        event.respondWith(staleWhileRevalidate(req));
        return;
    }

    // default
    event.respondWith(cacheFirst(req));
});
