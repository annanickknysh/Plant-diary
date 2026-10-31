// Экран «Разбор»: неразобранные фото, сгруппированные в прогулки.
import { h, photoImg } from '../ui/dom.js';
import { photosByStatus, countPhotos, getSetting, setSetting, placesNeedingPlants, catalog, parentPath } from '../data/store.js';
import { icon } from '../ui/dom.js';
import { backupReminder } from '../ui/backupCard.js';
import { groupWalks } from '../lib/walks.js';
import { formatDate, formatTime, formatNumber, plural, PHOTO_FORMS } from '../lib/format.js';
import { importButtons } from '../ui/importButtons.js';
import { rerender } from '../app.js';

const PAGE = 20;
const ui = { onlyNoDate: false, shown: PAGE, allNeeds: false };

export async function queueView() {
  const [fresh, counts, gap, order] = await Promise.all([
    photosByStatus('new'), countPhotos(), getSetting('walkGapMinutes'), getSetting('queueOrder'),
  ]);
  const page = h('div', { class: 'page' });
  const active = counts.fresh + counts.tagged;

  page.append(h('header', { class: 'page-head' }, h('h1', null, 'Разбор')));

  if (counts.total === 0) {
    page.append(h('section', { class: 'empty' },
      h('h2', null, 'Добавьте фото растений'),
      h('p', null, 'Выберите снимки из галереи или целую папку — можно только за нужный период. Приложение прочитает даты съёмки, уберёт дубли и сгруппирует фото в прогулки, чтобы их было быстро разметить.'),
      h('p', { class: 'muted' }, 'Фото хранятся только на этом устройстве.'),
      importButtons()));
    return page;
  }

  const reminder = await backupReminder(counts.tagged);
  if (reminder) page.append(reminder);

  const pct = active ? Math.round((counts.tagged / active) * 100) : 100;
  page.append(h('section', { class: 'progress-block' },
    h('div', { class: 'row-between' },
      h('p', null, 'Осталось ', h('strong', null, formatNumber(counts.fresh)), ` из ${formatNumber(active)} ${plural(active, PHOTO_FORMS)}`),
      h('span', { class: 'muted' }, `${pct}%`)),
    h('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Разобрано', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('div', { style: { width: `${pct}%` } }))));

  const needs = await placesNeedingPlants();
  if (counts.fresh === 0) {
    page.append(h('section', { class: 'empty' },
      h('h2', null, 'Всё разобрано'),
      h('p', null, 'Неразобранных фото не осталось. Добавьте новые, когда появятся.'),
      importButtons({ compact: true })));
    const sec = needsSection(needs);
    if (sec) page.append(sec);
    return page;
  }

  const noDateCount = fresh.filter((p) => p.dateApprox).length;
  const setOrder = async (o) => { await setSetting('queueOrder', o); ui.shown = PAGE; rerender(); };
  page.append(h('div', { class: 'chips-row' },
    h('button', { class: 'pill', type: 'button', 'aria-pressed': String(order === 'old'), onClick: () => setOrder('old') }, 'Сначала старые'),
    h('button', { class: 'pill', type: 'button', 'aria-pressed': String(order === 'new'), onClick: () => setOrder('new') }, 'Сначала новые'),
    noDateCount ? h('button', {
      class: 'pill warn', type: 'button', 'aria-pressed': String(ui.onlyNoDate),
      onClick: () => { ui.onlyNoDate = !ui.onlyNoDate; ui.shown = PAGE; rerender(); },
    }, `Без даты · ${formatNumber(noDateCount)}`) : null));

  const sec = needsSection(needs);
  if (sec) page.append(sec);

  let walks = groupWalks(ui.onlyNoDate ? fresh.filter((p) => p.dateApprox) : fresh, gap);
  if (order === 'new') walks.reverse();
  const list = h('div', { class: 'walk-list' });
  for (const w of walks.slice(0, ui.shown)) list.append(walkCard(w));
  page.append(list);
  if (walks.length > ui.shown) {
    page.append(h('button', { class: 'btn block', type: 'button', onClick: () => { ui.shown += PAGE; rerender(); } },
      `Показать ещё (${formatNumber(walks.length - ui.shown)})`));
  }
  page.append(h('div', { class: 'add-more' }, importButtons({ compact: true })));
  return page;
}

/** Клумбы, где есть фото без отмеченных растений — чтобы вернуться и доразметить. */
function needsSection(needs) {
  if (!needs.size) return null;
  const rows = [...needs.entries()].sort((a, b) => b[1] - a[1]);
  const shown = ui.allNeeds ? rows : rows.slice(0, 3);
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Доразметить растения'),
    h('p', { class: 'muted small' }, 'Фото уже отмечены клумбой, но растения на них ещё не указаны.'),
    h('div', { class: 'list' }, shown.map(([id, n]) => h('a', { class: 'list-row compact', href: `#/tagplace/${id}` },
      h('span', { class: 'list-text' }, h('span', { class: 'list-title' }, catalog.places.get(id).name),
        h('span', { class: 'list-sub' }, [parentPath(id), `${formatNumber(n)} ${plural(n, PHOTO_FORMS)} без растений`].filter(Boolean).join(' · '))),
      icon('chevron', 18)))),
    rows.length > 3 ? h('button', { class: 'btn small ghost', type: 'button', onClick: () => { ui.allNeeds = !ui.allNeeds; rerender(); } },
      ui.allNeeds ? 'Свернуть' : `Показать все клумбы (${rows.length})`) : null);
}

function walkCard(w) {
  const n = w.photos.length;
  const hasGps = w.photos.some((p) => typeof p.lat === 'number');
  const approx = w.photos.every((p) => p.dateApprox);
  const time = w.start === w.end ? formatTime(w.start) : `${formatTime(w.start)}–${formatTime(w.end)}`;
  const meta = [time, hasGps ? 'есть GPS' : 'без GPS'];
  if (approx) meta.push('дата неточная');
  const sample = pickSample(w.photos, 5);
  return h('article', { class: 'walk-card' },
    h('div', { class: 'row-between' },
      h('div', null, h('h2', { class: 'walk-date' }, formatDate(w.start)), h('p', { class: 'muted small' }, meta.join(' · '))),
      h('span', { class: 'count-badge' }, `${formatNumber(n)} ${plural(n, PHOTO_FORMS)}`)),
    h('div', { class: 'thumb-strip' }, sample.map((p) => h('div', { class: 'thumb' }, photoImg(p.id)))),
    h('a', { class: 'btn primary block', href: `#/walk/${w.id}` }, 'Разобрать прогулку'));
}

function pickSample(arr, k) {
  if (arr.length <= k) return arr;
  const out = [];
  for (let i = 0; i < k; i++) out.push(arr[Math.floor((i * (arr.length - 1)) / (k - 1))]);
  return out;
}
