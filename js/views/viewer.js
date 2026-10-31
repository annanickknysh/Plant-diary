// Полноэкранный просмотр фото с листанием и отметками.
import { h, icon, clear, photoImg } from '../ui/dom.js';
import { formatDate, formatTime } from '../lib/format.js';
import { catalog, plantName, placePath, setPhotoTags, getPhoto, tagPhotos, deletePhotos, restoreDeletedPhotos } from '../data/store.js';
import { toast, confirmAction } from '../ui/dom.js';
import { openTagSheet } from './tagSheet.js';

/**
 * @param opts.onChange — вызвать после правки отметок
 * @param opts.actions — дополнительные кнопки [{label, onClick(photo)}]
 */
export function openViewer(photos, index, { onChange, actions = [] } = {}) {
  let i = index;
  const prevFocus = document.activeElement;
  const overlay = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Просмотр фото' });
  const stage = h('div', { class: 'viewer-stage' });
  const info = h('div', { class: 'viewer-info' });
  const counter = h('span', { class: 'viewer-counter' });
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
  };
  const go = (d) => {
    const ni = i + d;
    if (ni < 0 || ni >= photos.length) return;
    i = ni;
    draw();
  };
  const onKey = (e) => {
    if (document.querySelector('.sheet-overlay')) return; // сначала закрывается панель поверх просмотра
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  };

  const drawInfo = async () => {
    const p = (await getPhoto(photos[i].id)) || photos[i];
    photos[i] = p;
    clear(info);
    info.append(h('div', { class: 'viewer-date' }, `${formatDate(p.takenAt)}, ${formatTime(p.takenAt)}`, p.dateApprox ? h('span', { class: 'chip warn' }, 'дата неточная') : null));
    const chips = h('div', { class: 'chips' });
    for (const id of p.placeIds) {
      if (!catalog.places.has(id)) continue;
      chips.append(h('span', { class: 'chip' }, placePath(id),
        h('button', { class: 'chip-x', type: 'button', 'aria-label': `Убрать отметку ${placePath(id)}`, onClick: () => removeTag('place', id) }, '×')));
    }
    for (const id of p.plantIds) {
      chips.append(h('span', { class: 'chip plant' }, plantName(catalog.plants.get(id)),
        h('button', { class: 'chip-x', type: 'button', 'aria-label': 'Убрать отметку растения', onClick: () => removeTag('plant', id) }, '×')));
    }
    if (!p.placeIds.length && !p.plantIds.length) chips.append(h('span', { class: 'muted' }, p.status === 'hidden' ? 'Скрыто: «не растение»' : 'Без отметок'));
    info.append(chips, h('div', { class: 'viewer-actions' },
      h('button', { class: 'btn small', type: 'button', onClick: addTag }, icon('plus', 18), 'Отметить'),
      actions.map((a) => h('button', { class: 'btn small', type: 'button', onClick: () => a.onClick(photos[i]) }, a.label)),
      h('button', { class: 'btn small', type: 'button', onClick: removePhoto }, icon('trash', 16), 'Удалить')));
    if (p.fileName) info.append(h('div', { class: 'viewer-file' }, p.folder ? `${p.folder}/${p.fileName}` : p.fileName));
  };

  const removeTag = async (kind, id) => {
    const p = photos[i];
    const placeIds = kind === 'place' ? p.placeIds.filter((x) => x !== id) : p.placeIds;
    const plantIds = kind === 'plant' ? p.plantIds.filter((x) => x !== id) : p.plantIds;
    await setPhotoTags(p.id, { placeIds, plantIds });
    onChange?.();
    drawInfo();
  };

  const removePhoto = async () => {
    if (!confirmAction('Удалить это фото из приложения? Оригинал в галерее или папке останется.')) return;
    const p = photos[i];
    const snapshot = await deletePhotos([p.id]);
    photos.splice(i, 1);
    onChange?.();
    toast('Фото удалено из приложения', { actionLabel: 'Отменить', duration: 10000, onAction: async () => { await restoreDeletedPhotos(snapshot); onChange?.(); } });
    if (!photos.length) { close(); return; }
    if (i >= photos.length) i = photos.length - 1;
    draw();
  };

  const addTag = () => {
    openTagSheet({
      photos: [photos[i]],
      mode: 'plant',
      onApply: async (sel) => {
        await tagPhotos([photos[i].id], sel);
        onChange?.();
        drawInfo();
      },
    });
  };

  const draw = () => {
    clear(stage).append(photoImg(photos[i].id, 'f', { class: 'viewer-img' }));
    counter.textContent = `${i + 1} из ${photos.length}`;
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === photos.length - 1;
    drawInfo();
  };

  const prevBtn = h('button', { class: 'viewer-nav prev', type: 'button', 'aria-label': 'Предыдущее фото', onClick: () => go(-1) }, icon('prev', 28));
  const nextBtn = h('button', { class: 'viewer-nav next', type: 'button', 'aria-label': 'Следующее фото', onClick: () => go(1) }, icon('next', 28));

  // Свайп влево/вправо
  let sx = null;
  stage.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    sx = null;
  });

  overlay.append(
    h('div', { class: 'viewer-top' }, counter, h('button', { class: 'icon-btn light', type: 'button', 'aria-label': 'Закрыть', onClick: close }, icon('close'))),
    stage, prevBtn, nextBtn, info,
  );
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  draw();
  overlay.querySelector('.icon-btn')?.focus();
}
