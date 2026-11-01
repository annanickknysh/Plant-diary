// Service worker: приложение открывается и работает без интернета.
// При изменении любых файлов приложения поднимайте VERSION.
const VERSION = 'v0.7.4';
const CACHE = `plant-diary-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/lib/format.js',
  './js/lib/walks.js',
  './js/lib/seasons.js',
  './js/lib/geo.js',
  './js/lib/exif.js',
  './js/lib/periods.js',
  './js/data/db.js',
  './js/data/images.js',
  './js/data/store.js',
  './js/data/importer.js',
  './js/ui/dom.js',
  './js/ui/importButtons.js',
  './js/ui/photoGrid.js',
  './js/ui/placePicker.js',
  './js/ui/varietyPicker.js',
  './js/views/queue.js',
  './js/views/walk.js',
  './js/views/tagSheet.js',
  './js/views/viewer.js',
  './js/views/catalog.js',
  './js/views/more.js',
  './js/views/seasons.js',
  './js/views/comparePhotos.js',
  './js/views/placeTagging.js',
  './js/views/journal.js',
  './js/ui/entryForm.js',
  './js/ui/backupCard.js',
  './js/data/backup.js',
  './js/lib/zip.js',
  './js/lib/features.js',
  './js/data/similarity.js',
  './js/ui/assistantCard.js',
  './js/views/stats.js',
  './reset.html',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' — мимо HTTP-кэша браузера, чтобы все файлы были одной, новой версии
  // ?v=… — мимо кэшей браузера и GitHub, чтобы все файлы точно были одной, новой версии
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(FILES.map(async (f) => {
      const res = await fetch(`${f}${f.includes('?') ? '&' : '?'}v=${VERSION}`, { cache: 'reload' });
      if (!res.ok) throw new Error(`${f}: ${res.status}`);
      await c.put(f, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('plant-diary-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Крупные библиотеки (декодер HEIC) — в отдельном кэше: не скачиваются заново при каждом обновлении,
// а только при первом использовании. Имя файла содержит версию библиотеки.
const VENDOR_CACHE = 'pd-vendor-1';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (new URL(req.url).pathname.includes('/vendor/')) {
    e.respondWith(caches.open(VENDOR_CACHE).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }))));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});
