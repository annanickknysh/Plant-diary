// Сезоны по календарю: весна — март–май, лето — июнь–август, осень — сентябрь–ноябрь,
// зима — декабрь–февраль. Зима относится к году, в котором начинается (декабрь 2025 – февраль 2026 = зима 2025).

export const SEASONS = [
  { key: 'spring', name: 'Весна', months: [2, 3, 4] },
  { key: 'summer', name: 'Лето', months: [5, 6, 7] },
  { key: 'autumn', name: 'Осень', months: [8, 9, 10] },
  { key: 'winter', name: 'Зима', months: [11, 0, 1] },
];

/** @returns {{season: string, year: number}} */
export function seasonOf(ms) {
  const d = new Date(ms);
  const m = d.getMonth();
  const y = d.getFullYear();
  if (m >= 2 && m <= 4) return { season: 'spring', year: y };
  if (m >= 5 && m <= 7) return { season: 'summer', year: y };
  if (m >= 8 && m <= 10) return { season: 'autumn', year: y };
  return { season: 'winter', year: m === 11 ? y : y - 1 };
}

/** Границы сезона: [начало, конец) в мс местного времени. */
export function seasonRange(season, year) {
  const startMonth = { spring: 2, summer: 5, autumn: 8, winter: 11 }[season];
  const start = new Date(year, startMonth, 1).getTime();
  const end = new Date(year, startMonth + 3, 1).getTime();
  return [start, end];
}
