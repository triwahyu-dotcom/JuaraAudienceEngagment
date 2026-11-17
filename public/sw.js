// Service worker: menyimpan halaman dan berkas aplikasi supaya passport dan halaman crew
// tetap bisa dibuka saat sinyal hilang. Data (poin, stok) tetap diambil dari Supabase;
// permintaan ke luar domain ini tidak disentuh.
const CACHE = 'jp-shell-v2';
const PAGES = ['/', '/s/', '/crew/', '/admin/'];

async function precache() {
  const cache = await caches.open(CACHE);
  const assets = new Set();
  for (const page of PAGES) {
    try {
      const res = await fetch(page, { cache: 'no-cache' });
      if (!res.ok) continue;
      await cache.put(page, res.clone());
      const html = await res.text();
      for (const m of html.matchAll(/\/_next\/static\/[^"'\\\s)]+/g)) assets.add(m[0]);
    } catch (err) { /* halaman ini dicoba lagi pada kunjungan berikutnya */ }
  }
  await Promise.all([...assets].map((url) => cache.add(url).catch(() => {})));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

async function pageFromCache(pathname) {
  const cache = await caches.open(CACHE);
  return (await cache.match(pathname)) || (await cache.match(pathname.endsWith('/') ? pathname : pathname + '/')) || (await cache.match('/'));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Berkas aplikasi bernama unik per versi: aman diambil dari simpanan lebih dulu.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Halaman: jaringan dulu supaya versi terbaru terpakai; bila lambat atau putus, pakai simpanan.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await withTimeout(fetch(req), 4000);
        if (res.ok) { const cache = await caches.open(CACHE); cache.put(url.pathname, res.clone()); }
        return res;
      } catch (err) {
        const hit = await pageFromCache(url.pathname);
        if (hit) return hit;
        throw err;
      }
    })());
  }
});
