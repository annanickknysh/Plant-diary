// Порядок кадров слайд-шоу: все фото, один год или один сезон по годам с кадрами-разделителями.
import { seasonOf } from './seasons.js';

export const SEASON_IN = { spring: 'Весна', summer: 'Лето', autumn: 'Осень', winter: 'Зима' };

export const seasonLabel = (key, year) => (key === 'winter' ? `Зима ${year}–${String(year + 1).slice(2)}` : `${SEASON_IN[key]} ${year}`);

/** Кадры показа: фото и (в режиме сезона) кадры-разделители при смене года. */
export function buildSlides(photos, { mode, year, season }) {
  const sorted = [...photos].sort((a, b) => a.takenAt - b.takenAt);
  if (mode === 'year') return sorted.filter((p) => new Date(p.takenAt).getFullYear() === year).map((p) => ({ photo: p }));
  if (mode === 'season') {
    const out = [];
    let lastYear = null;
    for (const p of sorted) {
      const s = seasonOf(p.takenAt);
      if (s.season !== season) continue;
      if (s.year !== lastYear) {
        lastYear = s.year;
        out.push({ divider: seasonLabel(season, s.year), count: sorted.filter((x) => { const t = seasonOf(x.takenAt); return t.season === season && t.year === s.year; }).length });
      }
      out.push({ photo: p });
    }
    return out;
  }
  return sorted.map((p) => ({ photo: p }));
}

