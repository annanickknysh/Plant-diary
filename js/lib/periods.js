// Периоды для сеток «годы × сезоны / месяцы» и сравнения клумб.
import { seasonOf, SEASONS } from './seasons.js';

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTH_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/**
 * Режимы сетки:
 *  'seasons' — 4 столбца (весна, лето, осень, зима), строка — сезонный год;
 *  'months'  — 12 столбцов, строка — календарный год;
 *  'spring' | 'summer' | 'autumn' | 'winter' — месяцы одного сезона по годам.
 */
export const MODES = ['seasons', 'months', 'spring', 'summer', 'autumn', 'winter'];

export function columnsOf(mode) {
  if (mode === 'seasons') return SEASONS.map((s) => ({ key: s.key, label: s.name, short: s.name }));
  if (mode === 'months') return MONTH_SHORT.map((m, i) => ({ key: String(i), label: MONTH_FULL[i], short: m }));
  const s = SEASONS.find((x) => x.key === mode);
  if (!s) throw new Error(`неизвестный режим ${mode}`);
  return s.months.map((m) => ({ key: String(m), label: MONTH_FULL[m], short: MONTH_FULL[m] }));
}

/** Строка (год) и столбец фото в данном режиме, или null, если фото не попадает в сетку. */
export function placeInGrid(ms, mode) {
  const d = new Date(ms);
  const m = d.getMonth();
  if (mode === 'months') return { year: d.getFullYear(), col: String(m) };
  const s = seasonOf(ms);
  if (mode === 'seasons') return { year: s.year, col: s.season };
  if (s.season !== mode) return null;
  return { year: s.year, col: String(m) };
}

/** Границы ячейки [начало, конец) в мс. */
export function cellRange(mode, year, col) {
  if (mode === 'seasons') {
    const start = { spring: 2, summer: 5, autumn: 8, winter: 11 }[col];
    return [new Date(year, start, 1).getTime(), new Date(year, start + 3, 1).getTime()];
  }
  const m = Number(col);
  // Январь и февраль зимы относятся к следующему календарному году
  const y = mode === 'winter' && m < 2 ? year + 1 : year;
  return [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()];
}

export function cellKey(mode, year, col) {
  return `${mode}:${year}:${col}`;
}

/** Подпись ячейки: «весна 2025», «июнь 2024», «зима 2025/26». */
export function cellLabel(mode, year, col) {
  if (mode === 'seasons') {
    const name = SEASONS.find((s) => s.key === col).name.toLowerCase();
    return col === 'winter' ? `зима ${year}/${String(year + 1).slice(2)}` : `${name} ${year}`;
  }
  const m = Number(col);
  const y = mode === 'winter' && m < 2 ? year + 1 : year;
  return `${MONTH_FULL[m]} ${y}`;
}

/** Обложка: закреплённая, иначе снимок ближе всего к середине периода. */
export function pickCover(photos, range, pinnedId) {
  if (!photos.length) return null;
  if (pinnedId) {
    const pinned = photos.find((p) => p.id === pinnedId);
    if (pinned) return pinned;
  }
  const mid = (range[0] + range[1]) / 2;
  let best = photos[0];
  for (const p of photos) if (Math.abs(p.takenAt - mid) < Math.abs(best.takenAt - mid)) best = p;
  return best;
}

/**
 * Построить сетку.
 * @param photos — [{id, takenAt}]
 * @param mode — режим (см. MODES)
 * @param opts.years — показывать только эти годы (Set) или все
 * @param opts.pins — {cellKey: photoId}
 * @param opts.now — текущее время (для пометки будущих ячеек)
 * @returns {{columns, rows: [{year, cells: [{key, label, col, photos, cover, state}]}], years: number[]}}
 */
export function buildGrid(photos, mode, { years = null, pins = {}, now = Date.now() } = {}) {
  const columns = columnsOf(mode);
  const buckets = new Map();
  const allYears = new Set();
  for (const p of photos) {
    const pos = placeInGrid(p.takenAt, mode);
    if (!pos) continue;
    allYears.add(pos.year);
    const k = cellKey(mode, pos.year, pos.col);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  }
  const yearList = [];
  if (allYears.size) {
    const min = Math.min(...allYears);
    const max = Math.max(...allYears);
    for (let y = max; y >= min; y--) yearList.push(y);
  }
  const rows = yearList
    .filter((y) => !years || years.has(y))
    .map((year) => ({
      year,
      cells: columns.map((c) => {
        const key = cellKey(mode, year, c.key);
        const list = (buckets.get(key) || []).sort((a, b) => a.takenAt - b.takenAt);
        const range = cellRange(mode, year, c.key);
        const state = list.length ? 'photos' : range[0] > now ? 'future' : 'empty';
        return { key, col: c.key, label: cellLabel(mode, year, c.key), photos: list, cover: pickCover(list, range, pins[key]), state };
      }),
    }));
  return { columns, rows, years: yearList };
}

/**
 * Периоды для сравнения клумб: строки — периоды, где есть хоть одно фото, новые сверху.
 * @param groups — [{id, photos}] (по экземпляру в каждой клумбе)
 * @param granularity — 'seasons' | 'months'
 */
export function buildComparison(groups, granularity = 'seasons', { pins = {} } = {}) {
  const periods = new Map();
  for (const g of groups) {
    for (const p of g.photos) {
      const pos = placeInGrid(p.takenAt, granularity);
      const key = cellKey(granularity, pos.year, pos.col);
      if (!periods.has(key)) periods.set(key, { key, year: pos.year, col: pos.col, start: cellRange(granularity, pos.year, pos.col)[0], byGroup: new Map() });
      const per = periods.get(key);
      if (!per.byGroup.has(g.id)) per.byGroup.set(g.id, []);
      per.byGroup.get(g.id).push(p);
    }
  }
  return [...periods.values()]
    .sort((a, b) => b.start - a.start)
    .map((per) => {
      const range = cellRange(granularity, per.year, per.col);
      return {
        key: per.key,
        label: cellLabel(granularity, per.year, per.col),
        cells: groups.map((g) => {
          const list = (per.byGroup.get(g.id) || []).sort((a, b) => a.takenAt - b.takenAt);
          return { groupId: g.id, photos: list, cover: pickCover(list, range, pins[`${per.key}:${g.id}`]) };
        }),
      };
    });
}
