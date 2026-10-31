// Обёртка над IndexedDB. Всё хранится на устройстве.

const DB_NAME = 'plant-diary';
const VERSION = 2;
let dbPromise = null;

export const STORES = {
  photos: 'photos',     // {id(хэш), takenAt, dateApprox, lat, lon, fileName, folder, w, h, size, importedAt, status, placeIds[], plantIds[]}
  images: 'images',     // ключ `${id}:t` (превью) или `${id}:f` (рабочая копия) → Blob
  species: 'species',   // {id, name, latin, family, notes}
  cultivars: 'cultivars', // {id, speciesId, name, notes}
  places: 'places',     // {id, parentId, name, notes, lat, lon}
  plants: 'plants',     // {id, speciesId, cultivarId, placeId, plantedAt, status, prevPlantId, coverPhotoId, notes}
  entries: 'entries',   // записи дневника (этап 3)
  meta: 'meta',         // настройки и служебное
  features: 'features', // отпечатки фото для подсказок: ключ — id фото → {v, f: Float32Array}
};

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = (ev) => {
        const db = r.result;
        // Обновление по шагам: данные прежних версий сохраняются
        if (ev.oldVersion < 1) {
          const photos = db.createObjectStore(STORES.photos, { keyPath: 'id' });
          photos.createIndex('takenAt', 'takenAt');
          photos.createIndex('status', 'status');
          photos.createIndex('placeIds', 'placeIds', { multiEntry: true });
          photos.createIndex('plantIds', 'plantIds', { multiEntry: true });
          db.createObjectStore(STORES.images);
          for (const s of ['species', 'cultivars', 'places', 'plants', 'entries']) {
            db.createObjectStore(STORES[s], { keyPath: 'id' });
          }
          db.createObjectStore(STORES.meta);
        }
        if (ev.oldVersion < 2) db.createObjectStore(STORES.features);
      };
      r.onsuccess = () => {
        document.getElementById('blocked-note')?.remove();
        const db = r.result;
        // Если открылась новая версия приложения в другом окне — уступить ей базу
        db.onversionchange = () => { db.close(); location.reload(); };
        resolve(db);
      };
      r.onerror = () => reject(r.error);
      // Старая версия приложения открыта в другом окне и держит базу: ждём, пока её закроют
      r.onblocked = () => {
        const note = document.createElement('div');
        note.id = 'blocked-note';
        note.setAttribute('style', 'position:fixed;inset:auto 12px 12px;z-index:90;padding:14px 16px;border-radius:14px;background:#FBEBDD;color:#8A4B12;font:600 15px/1.4 sans-serif');
        note.textContent = 'Приложение обновляется, но старая версия ещё открыта в другом окне или вкладке. Закройте её — продолжу автоматически.';
        document.body.append(note);
      };
    });
  }
  return dbPromise;
}

export function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Выполнить fn внутри одной транзакции; результат — после её завершения. */
export async function tx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve()
      .then(() => fn(t))
      .then((v) => { result = v; }, (e) => { try { t.abort(); } catch { /* уже завершена */ } reject(e); });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Транзакция прервана'));
  });
}

export const get = (store, key) => tx([store], 'readonly', (t) => promisify(t.objectStore(store).get(key)));
export const getAll = (store) => tx([store], 'readonly', (t) => promisify(t.objectStore(store).getAll()));
export const put = (store, value, key) =>
  tx([store], 'readwrite', (t) => promisify(key === undefined ? t.objectStore(store).put(value) : t.objectStore(store).put(value, key)));
export const del = (store, key) => tx([store], 'readwrite', (t) => promisify(t.objectStore(store).delete(key)));
export const count = (store) => tx([store], 'readonly', (t) => promisify(t.objectStore(store).count()));

export const getAllByIndex = (store, index, key) =>
  tx([store], 'readonly', (t) => promisify(t.objectStore(store).index(index).getAll(key)));
export const countByIndex = (store, index, key) =>
  tx([store], 'readonly', (t) => promisify(t.objectStore(store).index(index).count(key)));

/** Изменить несколько фото в одной транзакции. mutate(photo) меняет объект на месте. */
export function updatePhotos(ids, mutate) {
  return tx([STORES.photos], 'readwrite', async (t) => {
    const s = t.objectStore(STORES.photos);
    const changed = [];
    for (const id of ids) {
      const p = await promisify(s.get(id));
      if (!p) continue;
      mutate(p);
      p.updatedAt = Date.now();
      s.put(p);
      changed.push(p);
    }
    return changed;
  });
}
