// Доразметка растений на фото, уже отмеченных клумбой. Можно возвращаться сколько угодно раз:
// отметки растений добавляются к уже стоящим.
import { h, icon, photoImg, toast } from '../ui/dom.js';
import { catalog, photosOfPlace, tagPhotos, restorePhotos, placePath, isView, plantName } from '../data/store.js';
import { formatDate, formatDayShort, formatNumber, plural, PHOTO_FORMS } from '../lib/format.js';
import { openTagSheet } from './tagSheet.js';
import { openViewer } from './viewer.js';
import { rerender } from '../app.js';

const memory = new Map(); // placeId → {filter, selected:Set}

export async function placeTaggingView(placeId) {
  const place = catalog.places.get(placeId);
  const page = h('div', { class: 'page walk-page has-action-bar' });
  page.append(h('a', { class: 'back-link', href: `#/place/${placeId}` }, icon('back', 20), place?.name || 'Назад'));
  if (!place || isView(placeId)) {
    page.append(h('section', { class: 'empty' }, h('h2', null, 'Недоступно'), h('p', null, 'Растения отмечаются только на фото клумб.')));
    return page;
  }
  if (!memory.has(placeId)) memory.set(placeId, { filter: 'without', selected: new Set() });
  const mem = memory.get(placeId);

  const all = (await photosOfPlace(placeId)).filter((p) => p.status !== 'hidden').sort((a, b) => a.takenAt - b.takenAt);
  // Фото, отмеченные видом, — это общие планы: растения на них не размечаем
  const without = all.filter((p) => !p.plantIds.length && !p.placeIds.some(isView));
  const photos = mem.filter === 'without' ? without : all;
  const ids = new Set(photos.map((p) => p.id));
  for (const id of [...mem.selected]) if (!ids.has(id)) mem.selected.delete(id);
  const sel = mem.selected;

  page.append(h('header', { class: 'page-head tight' },
    h('h1', null, 'Растения на фото'),
    h('p', { class: 'muted' }, `${placePath(placeId)} · выберите фото и отметьте, какие растения на них видны. Можно возвращаться и добавлять растения в несколько заходов.`)));

  const setFilter = (f) => { mem.filter = f; sel.clear(); rerender(); };
  page.append(h('div', { class: 'chips-row' },
    h('button', { class: 'pill', type: 'button', 'aria-pressed': String(mem.filter === 'without'), onClick: () => setFilter('without') }, `Без растений · ${formatNumber(without.length)}`),
    h('button', { class: 'pill', type: 'button', 'aria-pressed': String(mem.filter === 'all'), onClick: () => setFilter('all') }, `Все фото · ${formatNumber(all.length)}`)));

  if (!photos.length) {
    page.classList.remove('has-action-bar');
    page.append(h('section', { class: 'empty' },
      h('h2', null, mem.filter === 'without' ? 'Доразмечать больше нечего' : 'Фото этой клумбы пока нет'),
      h('p', null, mem.filter === 'without' ? 'Можно открыть «Все фото» и добавить ещё растения.' : 'Отметьте фото клумбой на экране «Разбор».')));
    return page;
  }

  const countEl = h('strong', null);
  const tiles = new Map();
  const footerButtons = [];
  const refresh = () => {
    countEl.textContent = `Выбрано ${formatNumber(sel.size)}`;
    for (const [id, el] of tiles) {
      el.classList.toggle('on', sel.has(id));
      el.setAttribute('aria-pressed', String(sel.has(id)));
    }
    footerButtons.forEach((b) => { b.disabled = sel.size === 0; });
  };

  page.append(h('div', { class: 'toolbar' }, countEl, h('div', { class: 'toolbar-actions' },
    h('button', { class: 'pill', type: 'button', onClick: () => { photos.forEach((p) => sel.add(p.id)); refresh(); } }, 'Выбрать все'),
    h('button', { class: 'pill', type: 'button', onClick: () => { sel.clear(); refresh(); } }, 'Снять'))));

  // Группы по дням съёмки
  let day = null;
  let grid = null;
  let last = null;
  const order = photos.map((p) => p.id);
  photos.forEach((p, idx) => {
    const d = formatDate(p.takenAt);
    if (d !== day) {
      day = d;
      grid = h('div', { class: 'photo-grid selectable' });
      page.append(h('h3', { class: 'month-head' }, d), grid);
    }
    const names = p.plantIds.map((id) => plantName(catalog.plants.get(id)));
    const tile = h('button', { class: 'tile', type: 'button', 'aria-label': `Фото ${formatDayShort(p.takenAt)}${names.length ? `, отмечено: ${names.join(', ')}` : ''}` },
      photoImg(p.id),
      p.plantIds.length ? h('span', { class: 'tile-plants', title: names.join('\n') }, icon('leaf', 13), String(p.plantIds.length)) : null,
      p.placeIds.some(isView) && mem.filter === 'all' ? h('span', { class: 'tile-date' }, 'вид') : null,
      h('span', { class: 'tile-check', 'aria-hidden': 'true' }, icon('check', 16)));
    tile.addEventListener('click', (e) => {
      if (e.shiftKey && last !== null) {
        const [a, b] = [Math.min(last, idx), Math.max(last, idx)];
        const target = !sel.has(p.id);
        for (let k = a; k <= b; k++) target ? sel.add(order[k]) : sel.delete(order[k]);
      } else if (sel.has(p.id)) sel.delete(p.id);
      else sel.add(p.id);
      last = idx;
      refresh();
    });
    tiles.set(p.id, tile);
    grid.append(h('div', { class: 'tile-wrap' }, tile,
      h('button', { class: 'tile-zoom', type: 'button', 'aria-label': 'Открыть крупно', onClick: () => openViewer(photos, idx, { onChange: () => rerender() }) }, icon('expand', 16))));
  });

  const plantBtn = h('button', {
    class: 'btn primary block', type: 'button',
    onClick: () => openTagSheet({
      photos: photos.filter((p) => sel.has(p.id)),
      mode: 'plant',
      onApply: async (selection) => {
        const chosen = [...sel];
        const snapshot = await tagPhotos(chosen, selection);
        sel.clear();
        toast(`Растения отмечены на ${formatNumber(chosen.length)} ${plural(chosen.length, PHOTO_FORMS)}`, {
          actionLabel: 'Отменить', duration: 10000, onAction: async () => { await restorePhotos(snapshot); rerender(); },
        });
        rerender();
      },
    }),
  }, icon('leaf', 20), 'Отметить растения…');
  const viewBtn = h('button', {
    class: 'btn ghost block', type: 'button',
    onClick: () => openTagSheet({
      photos: photos.filter((p) => sel.has(p.id)),
      mode: 'place',
      startLevel: place.parentId || null,
      onApply: async (selection) => {
        const chosen = [...sel];
        const snapshot = await tagPhotos(chosen, selection);
        sel.clear();
        toast(`Отмечено видом: ${formatNumber(chosen.length)} ${plural(chosen.length, PHOTO_FORMS)}`, {
          actionLabel: 'Отменить', duration: 10000, onAction: async () => { await restorePhotos(snapshot); rerender(); },
        });
        rerender();
      },
    }),
  }, icon('eye', 18), 'Это вид… (растения не размечаю)');
  footerButtons.push(plantBtn, viewBtn);
  page.append(h('footer', { class: 'action-bar' }, plantBtn, viewBtn));
  refresh();
  return page;
}
