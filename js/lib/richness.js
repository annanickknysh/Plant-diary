// «Богатство» места или растения: сколько лет снимали, какие сезоны есть в разных годах, сколько избранных пар.
import { seasonOf } from './seasons.js';

export const SEASON_SHORT = { spring: 'весна', summer: 'лето', autumn: 'осень', winter: 'зима' };
const ORDER = ['spring', 'summer', 'autumn', 'winter'];

/** Накопитель по одному объекту. */
export function newRich() {
  return { years: new Set(), seasons: { spring: new Set(), summer: new Set(), autumn: new Set(), winter: new Set() }, stars: 0 };
}

export function addPhoto(rich, takenAt) {
  rich.years.add(new Date(takenAt).getFullYear());
  const s = seasonOf(takenAt);
  rich.seasons[s.season].add(s.year);
}

/** Чем больше лет, повторов сезонов и избранных пар — тем «интереснее». */
export function richScore(r) {
  if (!r) return 0;
  return r.stars * 3 + Math.max(0, r.years.size - 1) * 2 + ORDER.reduce((s, k) => s + Math.max(0, r.seasons[k].size - 1), 0);
}

const yearsWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'год' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'года' : 'лет');

/** Короткая строка-отметка: «★2 · 3 года · лето ×3 · осень ×2». Пусто, если хвалиться нечем. */
export function richLabel(r) {
  if (!r) return '';
  const parts = [];
  if (r.stars) parts.push(`★${r.stars}`);
  if (r.years.size >= 2) parts.push(`${r.years.size} ${yearsWord(r.years.size)}`);
  for (const k of ORDER) if (r.seasons[k].size >= 2) parts.push(`${SEASON_SHORT[k]} ×${r.seasons[k].size}`);
  return parts.join(' · ');
}
