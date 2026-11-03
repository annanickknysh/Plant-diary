// Поворот фото: новая рабочая копия и превью, пересчёт обоих «отпечатков» — как при добавлении.
import { STORES, tx, promisify } from './db.js';
import { emit } from './store.js';
import { rotateBlob, makeResized, forgetURLs, THUMB_SIZE } from './images.js';
import { forget as forgetFeatures, featuresFor } from './similarity.js';
import { nnForget, nnEnsure } from './nnIndex.js';

/**
 * @param dir 1 — по часовой стрелке, −1 — против
 * @returns обновлённая запись фото
 */
export async function rotatePhoto(id, dir) {
  const full = await tx([STORES.images], 'readonly', (t) => promisify(t.objectStore(STORES.images).get(`${id}:f`)));
  if (!full) throw new Error('Картинка фото не найдена');
  const r = await rotateBlob(full, dir);
  const thumb = await makeResized(r.blob, THUMB_SIZE, 0.78);
  const photo = await tx([STORES.photos, STORES.images, STORES.features, STORES.embeddings], 'readwrite', async (t) => {
    const ph = t.objectStore(STORES.photos);
    const p = await promisify(ph.get(id));
    t.objectStore(STORES.images).put(r.blob, `${id}:f`);
    t.objectStore(STORES.images).put(thumb.blob, `${id}:t`);
    // Прежние отпечатки описывали неповёрнутый кадр — удаляем
    t.objectStore(STORES.features).delete(id);
    t.objectStore(STORES.embeddings).delete(id);
    if (!p) return null;
    const next = { ...p, w: r.width, h: r.height, rotatedAt: Date.now(), updatedAt: Date.now() };
    ph.put(next);
    return next;
  });
  forgetURLs(id);
  forgetFeatures(id);
  nnForget(id);
  // Пересчитать сразу, как при добавлении фото
  await featuresFor([id]).catch(() => {});
  await nnEnsure([id]).catch(() => {});
  emit('photos');
  return photo;
}
