// Кнопки «Добавить фото» и «Добавить папку»; для папки — выбор периода съёмки.
import { h, icon, openSheet } from './dom.js';
import { importFiles, isImageFile } from '../data/importer.js';
import { tx, STORES } from '../data/db.js';
import { formatDate, formatNumber, plural, PHOTO_FORMS } from '../lib/format.js';

// Выбор папки: Chrome на компьютере и Chrome на Android с версии 132.
const supportsFolders = () => 'webkitdirectory' in document.createElement('input');

const DAY = 24 * 3600 * 1000;
const dayStart = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const toInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromInput = (v) => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

/** Дата самого нового фото в дневнике (или null). */
function latestPhotoTime() {
  return tx([STORES.photos], 'readonly', (t) => new Promise((resolve, reject) => {
    const req = t.objectStore(STORES.photos).index('takenAt').openCursor(null, 'prev');
    req.onsuccess = () => resolve(req.result ? req.result.value.takenAt : null);
    req.onerror = () => reject(req.error);
  })).catch(() => null);
}

/** Панель «Какие фото из папки добавить». */
export async function openRangeSheet(fileList) {
  const images = [...fileList].filter(isImageFile);
  if (!images.length) { importFiles(fileList); return; }
  const times = images.map((f) => f.lastModified || 0).filter(Boolean);
  const minT = times.length ? Math.min(...times) : Date.now();
  const maxT = times.length ? Math.max(...times) : Date.now();
  const latest = await latestPhotoTime();
  const today = dayStart(Date.now());
  const folder = (images[0].webkitRelativePath || '').split('/')[0];

  const presets = [
    latest ? { key: 'new', label: `Новее ${formatDate(latest)}`, hint: 'после последнего фото в дневнике', from: dayStart(latest), to: Math.max(maxT, today) + DAY } : null,
    { key: 'all', label: 'Всю папку', from: dayStart(minT), to: dayStart(maxT) + DAY },
    { key: 'month', label: 'Последний месяц', from: today - 30 * DAY, to: today + DAY },
    { key: 'year', label: `${new Date().getFullYear()} год`, from: new Date(new Date().getFullYear(), 0, 1).getTime(), to: today + DAY },
  ].filter(Boolean);

  openSheet((close) => {
    let range = { from: presets[0].from, to: presets[0].to };
    const fromEl = h('input', { type: 'date', 'aria-label': 'С' });
    const toEl = h('input', { type: 'date', 'aria-label': 'По' });
    const estimate = h('p', { class: 'muted' });
    const go = h('button', { class: 'btn primary block', type: 'button' });
    const pills = h('div', { class: 'chips-row' });

    const sync = (presetKey = null) => {
      fromEl.value = toInput(range.from);
      toEl.value = toInput(range.to - DAY);
      pills.replaceChildren(...presets.map((p) => h('button', {
        class: 'pill', type: 'button', 'aria-pressed': String(p.key === presetKey),
        onClick: () => { range = { from: p.from, to: p.to }; sync(p.key); },
      }, p.label)));
      // Оценка по дате файла: точная дата снимка читается из EXIF уже при импорте
      const n = images.filter((f) => !f.lastModified || (f.lastModified >= range.from && f.lastModified < range.to)).length;
      estimate.textContent = `Примерно ${formatNumber(n)} ${plural(n, PHOTO_FORMS)} из ${formatNumber(images.length)} за этот период. Точную дату снимка приложение проверит при импорте.`;
      go.textContent = 'Добавить фото за период';
      go.disabled = range.from >= range.to;
    };
    const onDates = () => {
      if (!fromEl.value || !toEl.value) return;
      range = { from: fromInput(fromEl.value), to: fromInput(toEl.value) + DAY };
      sync();
    };
    fromEl.addEventListener('change', onDates);
    toEl.addEventListener('change', onDates);
    go.addEventListener('click', () => { close(); importFiles(images, { range }); });
    sync(presets[0].key);

    return h('div', { class: 'form range-sheet' },
      h('h2', { class: 'sheet-title' }, 'Какие фото добавить'),
      h('p', null, `${folder ? `Папка «${folder}»: ` : ''}${formatNumber(images.length)} ${plural(images.length, PHOTO_FORMS)}, файлы от ${formatDate(minT)} до ${formatDate(maxT)}.`),
      pills,
      h('div', { class: 'date-pair' },
        h('label', { class: 'field' }, h('span', null, 'С'), fromEl),
        h('label', { class: 'field' }, h('span', null, 'По'), toEl)),
      estimate,
      go,
      h('p', { class: 'muted small' }, 'Уже добавленные фото пропускаются сами, поэтому периоды можно пересекать.'));
  }, { label: 'Какие фото добавить' });
}

export function importButtons({ compact = false } = {}) {
  const files = h('input', { type: 'file', multiple: true, accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  files.addEventListener('change', () => { if (files.files.length) importFiles(files.files); files.value = ''; });
  const wrap = h('div', { class: `import-buttons${compact ? ' compact' : ''}` }, files,
    h('button', { class: 'btn primary', type: 'button', onClick: () => files.click() }, icon('image', 20), 'Добавить фото'));
  if (supportsFolders()) {
    const folder = h('input', { type: 'file', webkitdirectory: true, multiple: true, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    folder.webkitdirectory = true;
    folder.addEventListener('change', () => {
      const list = [...folder.files];
      folder.value = '';
      if (list.length) openRangeSheet(list);
    });
    wrap.append(folder, h('button', { class: 'btn', type: 'button', onClick: () => folder.click() }, icon('folder', 20), 'Добавить папку'));
  }
  return wrap;
}
