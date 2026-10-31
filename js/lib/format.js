// Форматирование дат и чисел по-русски.

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** «14 апреля 2023» */
export function formatDate(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

/** «14 апр» */
export function formatDayShort(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** «9:05» */
export function formatTime(ms) {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** «апрель 2023» */
export function formatMonthYear(ms) {
  const d = new Date(ms);
  return `${MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`;
}

export function monthName(m) {
  return MONTHS_NOM[m];
}

/** Русское склонение: plural(5, ['фото', 'фото', 'фото']) */
export function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** «4 812» */
export function formatNumber(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** «1,4 ГБ», «230 МБ» */
export function formatBytes(bytes) {
  if (!bytes) return '0 МБ';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1).replace('.', ',')} ГБ`;
  const mb = bytes / 1024 ** 2;
  return `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} МБ`;
}

/** «47 растений», «1 растение» */
export function countLabel(n, forms) {
  return `${formatNumber(n)} ${plural(n, forms)}`;
}

export const PHOTO_FORMS = ['фото', 'фото', 'фото'];
export const PLANT_FORMS = ['растение', 'растения', 'растений'];
