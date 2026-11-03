// Вкладка «Дневник»: съёмка сразу с отметкой и записи о событиях.
import { h, icon, photoImg, toast } from '../ui/dom.js';
import {
  catalog, photosForTarget, plantName, placePath, allEntries, ENTRY_TYPES,
} from '../data/store.js';
import { importFiles } from '../data/importer.js';
import { openTagSheet } from './tagSheet.js';
import { openViewer } from './viewer.js';
import { openEntryForm, entryList, quickEntry } from '../ui/entryForm.js';
import { formatDayShort, formatNumber, plural, PHOTO_FORMS } from '../lib/format.js';
import { rerender } from '../app.js';

// Что снимаем: {placeId, plantIds} — запоминается, пока открыто приложение
let target = null;
const ui = { type: null };

const targetName = (t) => (t.plantIds?.length ? t.plantIds.map((id) => plantName(catalog.plants.get(id))).join(', ') : placePath(t.placeId));
const targetValid = (t) => t && ((t.plantIds?.length && t.plantIds.every((id) => catalog.plants.has(id))) || (t.placeId && catalog.places.has(t.placeId)));

export async function journalView(kind, id) {
  if (kind === 'plant' && catalog.plants.has(id)) target = { placeId: null, plantIds: [id] };
  if (kind === 'place' && catalog.places.has(id)) target = { placeId: id, plantIds: [] };
  if (!targetValid(target)) target = null;

  const page = h('div', { class: 'page' });
  page.append(h('header', { class: 'page-head' }, h('h1', null, 'Дневник')));

  // ---------- съёмка ----------
  const chooseTarget = () => openTagSheet({
    photos: [], split: true, title: 'Что снимаем', cta: 'Выбрать',
    mode: target?.plantIds?.length ? 'plant' : target?.placeId && catalog.places.get(target.placeId)?.kind === 'view' ? 'view' : target?.placeId ? 'place' : 'plant',
    // Адрес экрана помнит цель (#/camera/plant/…) — меняем и его, иначе выбор перебьётся при перерисовке
    onApply: async (sel) => {
      target = sel;
      const next = sel.plantIds?.length === 1 ? `#/camera/plant/${sel.plantIds[0]}` : sel.placeId ? `#/camera/place/${sel.placeId}` : '#/camera';
      if (location.hash !== next && (sel.plantIds?.length <= 1)) location.hash = next; else rerender();
    },
  });

  const shoot = h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Съёмка'));
  if (!target) {
    shoot.append(
      h('p', { class: 'muted' }, 'Выберите клумбу, вид или растение — и все снимки сразу попадут в дневник с этой отметкой.'),
      h('button', { class: 'btn primary block', type: 'button', onClick: chooseTarget }, icon('camera', 20), 'Выбрать, что снимаем'));
  } else {
    const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    const gallery = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    const onFiles = (input) => () => {
      if (!input.files.length) return;
      const n = input.files.length;
      importFiles(input.files, { tag: target });
      input.value = '';
      toast(`Добавляю ${formatNumber(n)} ${plural(n, PHOTO_FORMS)} к «${targetName(target)}»`);
    };
    camera.addEventListener('change', onFiles(camera));
    gallery.addEventListener('change', onFiles(gallery));
    shoot.append(
      h('div', { class: 'target-row' },
        h('span', { class: 'list-text' }, h('span', { class: 'muted small' }, 'Снимаю'), h('span', { class: 'list-title' }, targetName(target))),
        h('button', { class: 'btn small', type: 'button', onClick: chooseTarget }, 'Сменить')),
      camera, gallery,
      h('div', { class: 'two-col' },
        h('button', { class: 'btn primary', type: 'button', onClick: () => camera.click() }, icon('camera', 20), 'Снять'),
        h('button', { class: 'btn', type: 'button', onClick: () => gallery.click() }, icon('image', 20), 'Из галереи')));

    const kind2 = target.plantIds?.length ? 'plant' : 'place';
    const tid = kind2 === 'plant' ? target.plantIds[0] : target.placeId;
    const recent = (await photosForTarget(kind2, tid)).sort((a, b) => b.takenAt - a.takenAt).slice(0, 6);
    if (recent.length) {
      shoot.append(h('h3', { class: 'eyebrow' }, 'Последние снимки'),
        h('div', { class: 'photo-grid' }, recent.map((p, i) => h('button', { class: 'tile', type: 'button', onClick: () => openViewer(recent, i, { onChange: () => rerender() }) },
          photoImg(p.id), h('span', { class: 'tile-date' }, formatDayShort(p.takenAt))))));
    }
    shoot.append(h('p', { class: 'muted small' }, 'Подсказка: прошлогодний снимок того же места рядом помогает повторить ракурс — откройте его в «Сезонах».'));
  }
  page.append(shoot);

  // ---------- записи ----------
  const entries = await allEntries();
  const quickTarget = target ? { plantId: target.plantIds?.[0] || null, placeId: target.plantIds?.length ? null : target.placeId } : {};
  page.append(h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Записи'),
    h('p', { class: 'muted small' }, target ? `Быстрая запись на сегодня для «${targetName(target)}»:` : 'Отметьте, что произошло: зацвело, подкормила, пересадила.'),
    target ? h('div', { class: 'chips-row' }, ENTRY_TYPES.slice(0, 5).map((t) => h('button', { class: 'pill', type: 'button', onClick: () => quickEntry(t.key, quickTarget, () => rerender()) }, t.quick))) : null,
    h('button', { class: 'btn block', type: 'button', onClick: () => openEntryForm({ ...quickTarget }, { onSaved: () => rerender() }) }, icon('plus', 20), 'Новая запись')));

  if (entries.length) {
    const types = [...new Set(entries.map((e) => e.type))];
    page.append(h('h2', { class: 'section-title' }, 'Все записи'));
    if (types.length > 1) {
      page.append(h('div', { class: 'chips-row' },
        h('button', { class: 'pill', type: 'button', 'aria-pressed': String(!ui.type), onClick: () => { ui.type = null; rerender(); } }, 'Все'),
        ENTRY_TYPES.filter((t) => types.includes(t.key)).map((t) => h('button', {
          class: 'pill', type: 'button', 'aria-pressed': String(ui.type === t.key), onClick: () => { ui.type = ui.type === t.key ? null : t.key; rerender(); },
        }, t.label))));
    }
    page.append(entryList(ui.type ? entries.filter((e) => e.type === ui.type) : entries, { onChange: () => rerender() }));
  }

  return page;
}

