// Карточка «Резервная копия и перенос» для экрана «Ещё».
import { h, icon, clear, toast } from './dom.js';
import { exportBackup, importBackup, lastExportAt } from '../data/backup.js';
import { formatDate, formatNumber, formatBytes, plural, PHOTO_FORMS } from '../lib/format.js';
import { rerender } from '../app.js';

// Результат последнего действия переживает перерисовку экрана
const last$ = { node: null, keep: false };
const keepAndRerender = () => { last$.keep = true; rerender(); };

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function share(blob, name) {
  const file = new File([blob], name, { type: 'application/zip' });
  try {
    await navigator.share({ files: [file], title: name });
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Не получилось поделиться — сохраните файл кнопкой «Скачать»');
  }
}

const canShareFiles = () => {
  try {
    return !!navigator.canShare?.({ files: [new File([''], 'x.zip', { type: 'application/zip' })] });
  } catch {
    return false;
  }
};

export async function backupCard() {
  const last = await lastExportAt();
  if (!last$.keep) last$.node = null; // при новом заходе на экран — чистый лист
  last$.keep = false;
  const status = last$.node || h('div', { class: 'backup-status', role: 'status', 'aria-live': 'polite' });
  last$.node = status;
  const card = h('section', { class: 'card', id: 'backup' },
    h('h2', { class: 'card-title' }, 'Резервная копия и перенос'),
    h('p', { class: 'muted' }, 'Весь дневник сохраняется в файл .zip. Тот же файл переносит данные между компьютером и телефоном: сохраните его на одном устройстве и загрузите на другом — данные сольются, ничего не пропадёт.'),
    h('p', null, last ? `Последний раз: ${formatDate(last)}.` : 'Резервную копию ещё не делали.'));

  const run = async (mode) => {
    buttons.forEach((b) => { b.disabled = true; });
    clear(status).append(h('p', null, 'Готовлю файл…'));
    try {
      const parts = await exportBackup(mode, (pr) => {
        if (pr.stage === 'images') clear(status).append(h('p', null, `Собираю фото: ${formatNumber(pr.done)} из ${formatNumber(pr.total)}`));
        if (pr.stage === 'pack') clear(status).append(h('p', null, pr.parts > 1 ? `Упаковываю часть ${pr.part} из ${pr.parts}…` : 'Упаковываю…'));
      });
      clear(status);
      if (!parts.some((p) => p.photos) && mode === 'changes') status.append(h('p', { class: 'muted' }, 'С прошлого раза изменились только записи каталога — файл всё равно готов.'));
      status.append(h('p', { class: 'ok-note' }, parts.length > 1
        ? `Готово: ${parts.length} файла. Сохраните все — на другом устройстве их можно загрузить по одному в любом порядке.`
        : 'Готово. Сохраните файл в надёжное место: на компьютер, в облако или отправьте себе.'));
      const shareOk = canShareFiles();
      for (const p of parts) {
        status.append(h('div', { class: 'backup-file' },
          h('div', { class: 'list-text' }, h('span', { class: 'list-title' }, p.name),
            h('span', { class: 'list-sub' }, `${formatNumber(p.photos)} ${plural(p.photos, PHOTO_FORMS)} · ${formatBytes(p.blob.size)}`)),
          h('div', { class: 'row-actions' },
            h('button', { class: 'btn small primary', type: 'button', onClick: () => download(p.blob, p.name) }, 'Скачать'),
            shareOk ? h('button', { class: 'btn small', type: 'button', onClick: () => share(p.blob, p.name) }, 'Поделиться') : null)));
      }
      keepAndRerender();
    } catch (e) {
      clear(status).append(h('p', { class: 'form-error' }, e.message || String(e)));
    }
    buttons.forEach((b) => { b.disabled = false; });
  };

  const input = h('input', { type: 'file', accept: '.zip,application/zip', multiple: true, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    buttons.forEach((b) => { b.disabled = true; });
    const total = { catalogAdded: 0, catalogUpdated: 0, photosAdded: 0, photosMerged: 0, photosDeleted: 0, missingImages: 0, removed: 0 };
    try {
      for (let i = 0; i < files.length; i++) {
        const r = await importBackup(files[i], (pr) => {
          clear(status).append(h('p', null, `Загружаю${files.length > 1 ? ` файл ${i + 1} из ${files.length}` : ''}: фото ${formatNumber(pr.done)} из ${formatNumber(pr.total)}`));
        });
        Object.keys(total).forEach((k) => { total[k] += r[k] || 0; });
      }
      const lines = [
        `новых фото: ${formatNumber(total.photosAdded)}`,
        `обновлены отметки: ${formatNumber(total.photosMerged)}`,
        `растений, мест и записей добавлено: ${formatNumber(total.catalogAdded)}, обновлено: ${formatNumber(total.catalogUpdated)}`,
      ];
      if (total.photosDeleted || total.removed) lines.push(`удалено, как на другом устройстве: фото ${formatNumber(total.photosDeleted)}, записей ${formatNumber(total.removed)}`);
      if (total.missingImages) lines.push(`без изображений (загрузите полный файл): ${formatNumber(total.missingImages)}`);
      clear(status).append(h('p', { class: 'ok-note' }, 'Загружено.'), h('ul', { class: 'report' }, lines.map((l) => h('li', null, l))));
      toast('Дневник загружен');
      keepAndRerender();
    } catch (e) {
      clear(status).append(h('p', { class: 'form-error' }, e.message || String(e)));
    }
    buttons.forEach((b) => { b.disabled = false; });
  });

  const buttons = [
    h('button', { class: 'btn primary', type: 'button', onClick: () => run('all') }, icon('folder', 20), 'Сохранить весь дневник'),
    last ? h('button', { class: 'btn', type: 'button', onClick: () => run('changes') }, `Только изменения с ${formatDate(last)}`) : null,
    h('button', { class: 'btn', type: 'button', onClick: () => input.click() }, icon('plus', 20), 'Загрузить файл дневника'),
  ].filter(Boolean);
  card.append(h('div', { class: 'stack-buttons' }, buttons), input, status);
  return card;
}

/** Напоминание о резервной копии: давно не делали или ни разу. */
export async function backupReminder(taggedCount) {
  const last = await lastExportAt();
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  if ((last && days < 30) || (!last && taggedCount < 20)) return null;
  return h('a', { class: 'reminder', href: '#/more' },
    icon('folder', 20),
    h('span', null, last ? `Резервной копии ${days} ${plural(days, ['день', 'дня', 'дней'])}. Сохраните дневник в файл.` : 'Резервной копии ещё нет. Сохраните дневник в файл — на случай, если с телефоном что-то случится.'),
    icon('chevron', 18));
}
