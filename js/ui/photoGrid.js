// Сетка фото, сгруппированная по месяцам (новые сверху).
import { h, photoImg } from './dom.js';
import { formatMonthYear, formatDayShort } from '../lib/format.js';
import { openViewer } from '../views/viewer.js';

export function monthGroupedGrid(photos, { emptyText = 'Пока нет фото' } = {}) {
  const sorted = [...photos].sort((a, b) => b.takenAt - a.takenAt);
  if (!sorted.length) return h('p', { class: 'muted empty-note' }, emptyText);
  const wrap = h('div', { class: 'month-groups' });
  let key = null;
  let grid = null;
  sorted.forEach((p, i) => {
    const d = new Date(p.takenAt);
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    if (k !== key) {
      key = k;
      grid = h('div', { class: 'photo-grid' });
      wrap.append(h('h3', { class: 'month-head' }, formatMonthYear(p.takenAt)), grid);
    }
    grid.append(h('button', { class: 'tile', type: 'button', 'aria-label': `Фото ${formatDayShort(p.takenAt)}`, onClick: () => openViewer(sorted, i) },
      photoImg(p.id), h('span', { class: 'tile-date' }, formatDayShort(p.takenAt))));
  });
  return wrap;
}
