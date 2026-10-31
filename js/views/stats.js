// Фото по датам: календарь «годы × месяцы», дни со съёмкой, пробелы и неразобранное.
import { h, icon, photoImg } from '../ui/dom.js';
import { getAll, STORES } from '../data/db.js';
import { formatDate, formatNumber, plural, PHOTO_FORMS } from '../lib/format.js';
import { openViewer } from './viewer.js';
import { rerender } from '../app.js';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const ui = { filter: 'all', sel: null };

const FILTERS = [
  ['all', 'Все фото'],
  ['tagged', 'Размеченные'],
  ['new', 'Неразобранные'],
];

export async function statsView() {
  const all = (await getAll(STORES.photos)).filter((p) => p.status !== 'hidden');
  const page = h('div', { class: 'page' });
  page.append(h('a', { class: 'back-link', href: '#/seasons' }, icon('back', 20), 'Сезоны'),
    h('header', { class: 'page-head tight' }, h('h1', null, 'Фото по датам')));
  if (!all.length) {
    page.append(h('p', { class: 'muted empty-note' }, 'Фото пока нет.'));
    return page;
  }

  const tagged = all.filter((p) => p.status === 'tagged').length;
  const approx = all.filter((p) => p.dateApprox).length;
  const first = Math.min(...all.map((p) => p.takenAt));
  const last = Math.max(...all.map((p) => p.takenAt));
  const days = new Set(all.map((p) => { const d = new Date(p.takenAt); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }));
  page.append(h('dl', { class: 'stats card' },
    h('dt', null, 'Всего фото'), h('dd', null, formatNumber(all.length)),
    h('dt', null, 'Размечено'), h('dd', null, `${formatNumber(tagged)} (${Math.round((tagged / all.length) * 100)}%)`),
    h('dt', null, 'Ждут разбора'), h('dd', null, formatNumber(all.length - tagged)),
    h('dt', null, 'Период'), h('dd', null, `${formatDate(first)} — ${formatDate(last)}`),
    h('dt', null, 'Дней со съёмкой'), h('dd', null, formatNumber(days.size)),
    approx ? h('dt', null, 'С неточной датой') : null, approx ? h('dd', null, formatNumber(approx)) : null));

  page.append(h('div', { class: 'chips-row' }, FILTERS.map(([k, label]) => h('button', {
    class: 'pill', type: 'button', 'aria-pressed': String(ui.filter === k),
    onClick: () => { ui.filter = k; ui.sel = null; rerender(); },
  }, label))));

  const photos = ui.filter === 'all' ? all : all.filter((p) => p.status === ui.filter);
  // Год → месяц → {total, tagged}
  const grid = new Map();
  for (const p of photos) {
    const d = new Date(p.takenAt);
    const y = d.getFullYear();
    if (!grid.has(y)) grid.set(y, Array.from({ length: 12 }, () => ({ total: 0, tagged: 0 })));
    const cell = grid.get(y)[d.getMonth()];
    cell.total++;
    if (p.status === 'tagged') cell.tagged++;
  }
  const allYears = [...new Set(all.map((p) => new Date(p.takenAt).getFullYear()))];
  const years = [];
  for (let y = Math.max(...allYears); y >= Math.min(...allYears); y--) years.push(y);
  const max = Math.max(1, ...[...grid.values()].flat().map((c) => c.total));

  const table = h('div', { class: 'cal-grid' });
  table.append(h('span', null), ...MONTHS.map((m) => h('span', { class: 'cal-head' }, m)), h('span', { class: 'cal-head' }, 'итого'));
  for (const y of years) {
    const row = grid.get(y) || Array.from({ length: 12 }, () => ({ total: 0, tagged: 0 }));
    table.append(h('span', { class: 'cal-year' }, String(y)));
    row.forEach((c, m) => {
      if (!c.total) { table.append(h('span', { class: 'cal-cell empty', 'aria-label': `${MONTHS_FULL[m]} ${y}: нет фото` })); return; }
      const level = Math.min(4, Math.ceil((c.total / max) * 4));
      const sel = ui.sel && ui.sel.y === y && ui.sel.m === m;
      const untagged = c.total - c.tagged;
      table.append(h('button', {
        class: `cal-cell l${level}${sel ? ' sel' : ''}${ui.filter === 'all' && untagged ? ' has-new' : ''}`, type: 'button',
        'aria-label': `${MONTHS_FULL[m]} ${y}: ${c.total} ${plural(c.total, PHOTO_FORMS)}${untagged && ui.filter === 'all' ? `, не разобрано ${untagged}` : ''}`,
        onClick: () => { ui.sel = sel ? null : { y, m }; rerender(); },
      }, String(c.total)));
    });
    const total = row.reduce((s, c) => s + c.total, 0);
    table.append(h('span', { class: 'cal-total' }, total ? formatNumber(total) : '—'));
  }
  page.append(h('div', { class: 'grid-scroll' }, table));
  page.append(h('p', { class: 'muted small' }, ui.filter === 'all'
    ? 'Чем темнее клетка, тем больше фото. Точка — в месяце есть неразобранные фото. Нажмите на месяц, чтобы увидеть дни.'
    : 'Нажмите на месяц, чтобы увидеть дни и фото.'));

  if (ui.sel) {
    const { y, m } = ui.sel;
    const inMonth = photos.filter((p) => { const d = new Date(p.takenAt); return d.getFullYear() === y && d.getMonth() === m; })
      .sort((a, b) => a.takenAt - b.takenAt);
    const byDay = new Map();
    for (const p of inMonth) {
      const d = new Date(p.takenAt).getDate();
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(p);
    }
    const sec = h('section', { class: 'card', id: 'month-detail' },
      h('h2', { class: 'card-title' }, `${MONTHS_FULL[m][0].toUpperCase()}${MONTHS_FULL[m].slice(1)} ${y}`),
      h('p', { class: 'muted small' }, `${formatNumber(inMonth.length)} ${plural(inMonth.length, PHOTO_FORMS)} за ${byDay.size} ${plural(byDay.size, ['день', 'дня', 'дней'])}`));
    for (const [d, list] of byDay) {
      const untagged = list.filter((p) => p.status !== 'tagged').length;
      sec.append(h('div', { class: 'day-row' },
        h('div', { class: 'day-head' }, h('strong', null, formatDate(list[0].takenAt)),
          h('span', { class: 'muted small' }, [`${list.length} ${plural(list.length, PHOTO_FORMS)}`, untagged ? `не разобрано: ${untagged}` : null].filter(Boolean).join(' · '))),
        h('div', { class: 'thumb-strip day-strip' }, list.slice(0, 12).map((p, i) => h('button', {
          class: 'thumb', type: 'button', 'aria-label': `Фото ${i + 1}`, onClick: () => openViewer(list, i, { onChange: () => rerender() }),
        }, photoImg(p.id))))));
    }
    page.append(sec);
    requestAnimationFrame(() => document.getElementById('month-detail')?.scrollIntoView({ block: 'nearest' }));
  }
  return page;
}

