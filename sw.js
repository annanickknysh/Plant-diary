// Service worker: приложение открывается и работает без интернета.
// При изменении любых файлов приложения поднимайте VERSION.
const VERSION = 'v0.4.3';
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
];

self.addEventListener('install', (e) => {
  // cache: 'reload' — мимо HTTP-кэша браузера, чтобы все файлы были одной, новой версии
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('plant-diary-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
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
