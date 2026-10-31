// Экран прогулки: выбор фото и пакетная отметка.
import { h, icon, photoImg, toast, formSheet } from '../ui/dom.js';
import {
  photosByStatus, getSetting, tagPhotos, hidePhotos, restorePhotos, shiftPhotoDates,
} from '../data/store.js';
import { groupWalks } from '../lib/walks.js';
import { centerOf, distanceMeters } from '../lib/geo.js';
import { catalog } from '../data/store.js';
import { formatDate, formatTime, formatNumber, plural, PHOTO_FORMS } from '../lib/format.js';
import { openTagSheet } from './tagSheet.js';
import { openViewer } from './viewer.js';
import { rerender } from '../app.js';

// Память о прогулке между перерисовками: какие фото в неё входили и что выделено.
const memory = new Map(); // routeId → {ids:Set, selected:Set|null}

export async function walkView(routeId) {
  const [fresh, gap] = await Promise.all([photosByStatus('new'), getSetting('walkGapMinutes')]);
  const walks = groupWalks(fresh, gap);
  let mem = memory.get(routeId);
  let walk = mem
    ? walks.find((w) => w.photos.some((p) => mem.ids.has(p.id)))
    : walks.find((w) => w.id === routeId);
  if (!mem && walk) {
    mem = { ids: new Set(walk.photos.map((p) => p.id)), selected: null, last: null };
    memory.set(routeId, mem);
  }

  const page = h('div', { class: 'page walk-page has-action-bar' });
  page.append(h('a', { class: 'back-link', href: '#/queue' }, icon('back', 20), 'Разбор'));

  if (!walk) {
    memory.delete(routeId);
    page.append(h('section', { class: 'empty' }, h('h2', null, 'Прогулка разобрана'), h('p', null, 'Все фото отсюда уже отмечены или скрыты.'),
      h('a', { class: 'btn primary', href: '#/queue' }, 'К следующей прогулке')));
    return page;
  }

  const photos = walk.photos;
  const ids = photos.map((p) => p.id);
  // В памяти держим только фото, которые ещё остались в прогулке
  mem.ids = new Set([...mem.ids, ...ids]);
  if (!mem.selected) mem.selected = new Set(ids);
  for (const id of [...mem.selected]) if (!ids.includes(id)) mem.selected.delete(id);
  const sel = mem.selected;

  const center = centerOf(photos);
  let nearName = null;
  if (center) {
    const near = [...catalog.places.values()].filter((p) => typeof p.lat === 'number')
      .map((p) => ({ p, d: distanceMeters(center, p) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d <= 150) nearName = near.p.name;
  }
  const n = photos.length;
  const time = walk.start === walk.end ? formatTime(walk.start) : `${formatTime(walk.start)}–${formatTime(walk.end)}`;
  page.append(h('header', { class: 'page-head tight' },
    h('h1', null, formatDate(walk.start)),
    h('p', { class: 'muted' }, [`${formatNumber(n)} ${plural(n, PHOTO_FORMS)}`, time, nearName ? `ближе всего: ${nearName}` : null].filter(Boolean).join(' · '))));

  const countEl = h('strong', null);
  const grid = h('div', { class: 'photo-grid selectable' });
  const tiles = new Map();

  const footerButtons = [];
  const refresh = () => {
    countEl.textContent = `Выбрано ${formatNumber(sel.size)}`;
    for (const [id, el] of tiles) {
      const on = sel.has(id);
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', String(on));
    }
    for (const b of footerButtons) b.disabled = sel.size === 0;
  };

  photos.forEach((p, idx) => {
    const tile = h('button', { class: 'tile', type: 'button', 'aria-label': `Фото ${formatTime(p.takenAt)}` },
      photoImg(p.id),
      h('span', { class: 'tile-date' }, formatTime(p.takenAt)),
      h('span', { class: 'tile-check', 'aria-hidden': 'true' }, icon('check', 16)));
    tile.addEventListener('click', (e) => {
      if (e.shiftKey && mem.last !== null) {
        const [a, b] = [Math.min(mem.last, idx), Math.max(mem.last, idx)];
        const target = !sel.has(p.id);
        for (let k = a; k <= b; k++) target ? sel.add(ids[k]) : sel.delete(ids[k]);
      } else if (sel.has(p.id)) sel.delete(p.id);
      else sel.add(p.id);
      mem.last = idx;
      refresh();
    });
    const zoom = h('button', { class: 'tile-zoom', type: 'button', 'aria-label': 'Открыть крупно', onClick: () => openViewer(photos, idx, { onChange: () => rerender() }) }, icon('expand', 16));
    tiles.set(p.id, tile);
    grid.append(h('div', { class: 'tile-wrap' }, tile, zoom));
  });

  page.append(h('div', { class: 'toolbar' }, countEl,
    h('div', { class: 'toolbar-actions' },
      h('button', { class: 'pill', type: 'button', onClick: () => { ids.forEach((id) => sel.add(id)); refresh(); } }, 'Выбрать все'),
      h('button', { class: 'pill', type: 'button', onClick: () => { sel.clear(); refresh(); } }, 'Снять'),
      h('button', { class: 'pill', type: 'button', onClick: () => editDate(photos, sel) }, 'Дата…'))));
  page.append(grid);

  const selectedPhotos = () => photos.filter((p) => sel.has(p.id));
  const apply = async (selection) => {
    const chosen = [...sel];
    const snapshot = await tagPhotos(chosen, selection);
    sel.clear();
    toast(`Отмечено: ${formatNumber(chosen.length)} ${plural(chosen.length, PHOTO_FORMS)}`, {
      actionLabel: 'Отменить', duration: 10000, onAction: async () => { await restorePhotos(snapshot); chosen.forEach((id) => sel.add(id)); rerender(); },
    });
    rerender();
  };
  const bedBtn = h('button', { class: 'btn primary', type: 'button', onClick: () => openTagSheet({ photos: selectedPhotos(), mode: 'place', onApply: apply }) }, 'Клумба или вид…');
  const plantBtn = h('button', { class: 'btn dark', type: 'button', onClick: () => openTagSheet({ photos: selectedPhotos(), mode: 'plant', onApply: apply }) }, 'Это растение…');
  const hideBtn = h('button', {
    class: 'btn ghost block', type: 'button',
    onClick: async () => {
      const chosen = [...sel];
      const snapshot = await hidePhotos(chosen);
      sel.clear();
      toast(`Скрыто: ${formatNumber(chosen.length)} ${plural(chosen.length, PHOTO_FORMS)}`, {
        actionLabel: 'Отменить', duration: 10000, onAction: async () => { await restorePhotos(snapshot); chosen.forEach((id) => sel.add(id)); rerender(); },
      });
      rerender();
    },
  }, 'Не растение — скрыть из разбора');
  footerButtons.push(bedBtn, plantBtn, hideBtn);
  page.append(h('footer', { class: 'action-bar' }, h('div', { class: 'two-col' }, bedBtn, plantBtn), hideBtn));
  refresh();
  return page;
}

function editDate(photos, sel) {
  const chosen = photos.filter((p) => sel.has(p.id));
  if (!chosen.length) {
    toast('Сначала выберите фото');
    return;
  }
  const first = chosen[0];
  const d = new Date(first.takenAt);
  const pad = (x) => String(x).padStart(2, '0');
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  formSheet({
    title: 'Дата съёмки',
    fields: [{ name: 'dt', label: `Новая дата первого из ${chosen.length} выбранных фото; остальные сдвинутся на столько же`, type: 'datetime-local', value: local, required: true }],
    submitLabel: 'Сохранить дату',
    onSubmit: async ({ dt }) => {
      const t = new Date(dt).getTime();
      if (!isFinite(t)) throw new Error('Укажите дату и время.');
      const delta = t - first.takenAt;
      await shiftPhotoDates(chosen.map((p) => p.id), delta);
      const { updatePhotos } = await import('../data/db.js');
      await updatePhotos(chosen.map((p) => p.id), (p) => { p.dateApprox = false; });
      toast('Дата обновлена');
      rerender();
    },
  });
}
