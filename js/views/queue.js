// Экран «Разбор»: неразобранные фото, сгруппированные в прогулки.
import { h, photoImg } from '../ui/dom.js';
import { photosByStatus, countPhotos, getSetting, setSetting } from '../data/store.js';
import { groupWalks } from '../lib/walks.js';
import { formatDate, formatTime, formatNumber, plural, PHOTO_FORMS } from '../lib/format.js';
import { importButtons } from '../ui/importButtons.js';
import { rerender } from '../app.js';

const PAGE = 20;
const ui = { onlyNoDate: false, shown: PAGE };

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
      h('p', null, 'Выберите снимки из галереи или, на компьютере, целую папку. Приложение прочитает даты съёмки, уберёт дубли и сгруппирует фото в прогулки, чтобы их было быстро разметить.'),
      h('p', { class: 'muted' }, 'Фото хранятся только на этом устройстве.'),
      importButtons()));
    return page;
  }

  const pct = active ? Math.round((counts.tagged / active) * 100) : 100;
  page.append(h('section', { class: 'progress-block' },
    h('div', { class: 'row-between' },
      h('p', null, 'Осталось ', h('strong', null, formatNumber(counts.fresh)), ` из ${formatNumber(active)} ${plural(active, PHOTO_FORMS)}`),
      h('span', { class: 'muted' }, `${pct}%`)),
    h('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Разобрано', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('div', { style: { width: `${pct}%` } }))));

  if (counts.fresh === 0) {
    page.append(h('section', { class: 'empty' },
      h('h2', null, 'Всё разобрано'),
      h('p', null, 'Неразобранных фото не осталось. Добавьте новые, когда появятся.'),
      importButtons({ compact: true })));
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
