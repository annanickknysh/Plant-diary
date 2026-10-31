// Группировка неразобранных фото в «прогулки»: снимки подряд с перерывом не больше порога.

/**
 * @param {Array<{id: string, takenAt: number}>} photos — в любом порядке
 * @param {number} gapMinutes — порог перерыва
 * @returns {Array<{id: string, start: number, end: number, photos: Array}>} прогулки по возрастанию времени
 */
export function groupWalks(photos, gapMinutes = 20) {
  const sorted = [...photos].sort((a, b) => a.takenAt - b.takenAt || (a.id < b.id ? -1 : 1));
  const gap = gapMinutes * 60 * 1000;
  const walks = [];
  let cur = null;
  for (const p of sorted) {
    if (!cur || p.takenAt - cur.end > gap) {
      cur = { id: p.id, start: p.takenAt, end: p.takenAt, photos: [] };
      walks.push(cur);
    }
    cur.photos.push(p);
    cur.end = p.takenAt;
  }
  return walks;
}
