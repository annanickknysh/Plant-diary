// Экран «Ещё»: импорт, хранилище, скрытые фото, настройки.
import { h, icon, photoImg, toast, confirmAction } from '../ui/dom.js';
import { countPhotos, getSetting, setSetting, photosByStatus, untrashPhotos, deletedIds, forgetDeleted, deletePhotos, tagPhotos } from '../data/store.js';
import { importFiles } from '../data/importer.js';
import { openTagSheet } from './tagSheet.js';
import { openViewer } from './viewer.js';
import { importButtons } from '../ui/importButtons.js';
import { backupCard } from '../ui/backupCard.js';
import { assistantCard } from '../ui/assistantCard.js';
import { formatNumber, formatBytes, formatDayShort, plural, PHOTO_FORMS } from '../lib/format.js';
import { rerender } from '../app.js';

export const APP_VERSION = '0.11.0';

async function checkUpdates() {
  const reg = await navigator.serviceWorker?.getRegistration?.();
  if (!reg) { location.reload(); return; }
  toast('Проверяю…');
  try {
    await reg.update();
  } catch {
    toast('Не удалось проверить — нет интернета?');
    return;
  }
  const incoming = reg.installing || reg.waiting;
  if (!incoming) { toast('У вас последняя версия'); return; }
  toast('Загружаю новую версию…', { duration: 10000 });
  const done = () => location.reload();
  if (incoming.state === 'activated') done();
  incoming.addEventListener('statechange', () => { if (incoming.state === 'activated') done(); });
}

export async function moreView() {
  const [counts, gap, quality, estimate, persisted, deleted] = await Promise.all([
    countPhotos(),
    getSetting('walkGapMinutes'),
    getSetting('fullQuality'),
    navigator.storage?.estimate?.().catch(() => null),
    navigator.storage?.persisted?.().catch(() => null),
    deletedIds(),
  ]);
  const page = h('div', { class: 'page' });
  page.append(h('header', { class: 'page-head' }, h('h1', null, 'Ещё')));

  page.append(h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Добавить фото'),
    h('p', { class: 'muted' }, 'Дубли распознаются автоматически, поэтому одну и ту же папку можно выбирать повторно — например, если импорт прервался.'),
    importButtons()));
  page.append(await backupCard());
  page.append(await assistantCard());

  page.append(h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Фото'),
    h('dl', { class: 'stats' },
      h('dt', null, 'Всего'), h('dd', null, formatNumber(counts.total)),
      h('dt', null, 'Разобрано'), h('dd', null, formatNumber(counts.tagged)),
      h('dt', null, 'Ждут разбора'), h('dd', null, formatNumber(counts.fresh)),
      h('dt', null, 'В корзине'), h('dd', null, formatNumber(counts.hidden))),
    h('a', { class: 'btn block', href: '#/stats' }, 'Фото по датам'),
    counts.hidden || deleted.size ? h('a', { class: 'btn block', href: '#/hidden' }, icon('trash', 18), `Корзина${counts.hidden ? ` (${formatNumber(counts.hidden)})` : ''}`) : null,
    deleted.size ? h('p', { class: 'muted small' }, `Удалено насовсем: ${formatNumber(deleted.size)} ${plural(deleted.size, PHOTO_FORMS)}. При повторном импорте они пропускаются; вернуть их можно в «Корзине».`) : null,
    deleted.size ? h('button', {
      class: 'btn small', type: 'button',
      onClick: async () => { await forgetDeleted(); toast('Удалённые фото снова можно импортировать'); rerender(); },
    }, 'Разрешить импортировать их снова') : null));

  const usage = estimate?.usage;
  const quota = estimate?.quota;
  page.append(h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Хранилище'),
    h('dl', { class: 'stats' },
      h('dt', null, 'Занято'), h('dd', null, usage != null ? formatBytes(usage) : 'неизвестно'),
      h('dt', null, 'Доступно браузеру'), h('dd', null, quota != null ? formatBytes(quota) : 'неизвестно')),
    persisted === true
      ? h('p', { class: 'ok-note' }, 'Постоянное хранение включено: браузер не удалит данные сам.')
      : h('div', null,
        h('p', { class: 'warn-note' }, 'Постоянное хранение не подтверждено. Установите приложение на главный экран — так браузер бережнее относится к данным.'),
        h('button', {
          class: 'btn small', type: 'button',
          onClick: async () => {
            const ok = await navigator.storage?.persist?.();
            toast(ok ? 'Постоянное хранение включено' : 'Браузер пока не разрешил — попробуйте после установки на главный экран');
            rerender();
          },
        }, 'Запросить снова'))));

  const gapSel = h('select', { id: 'gap' }, [10, 20, 30, 60, 120].map((m) => h('option', { value: m, selected: m === gap }, `${m} минут`)));
  gapSel.addEventListener('change', async () => { await setSetting('walkGapMinutes', Number(gapSel.value)); toast('Сохранено'); });
  const qSel = h('select', { id: 'quality' },
    h('option', { value: 'standard', selected: quality !== 'economy' }, 'Стандартное (~1600 px)'),
    h('option', { value: 'economy', selected: quality === 'economy' }, 'Экономное (~1200 px)'));
  qSel.addEventListener('change', async () => { await setSetting('fullQuality', qSel.value); toast('Сохранено. Действует для новых фото.'); });
  page.append(h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Настройки'),
    h('label', { class: 'field', for: 'gap' }, h('span', null, 'Новая прогулка, если перерыв между снимками больше'), gapSel),
    h('label', { class: 'field', for: 'quality' }, h('span', null, 'Качество копий для полноэкранного просмотра'), qSel)));

  page.append(
  h('div', { class: 'version-row' },
    h('p', { class: 'muted small' }, `Дневник растений · версия ${APP_VERSION}`),
    h('button', { class: 'btn small', type: 'button', onClick: checkUpdates }, 'Проверить обновления')));
  return page;
}

const hiddenSel = new Set();

/** Корзина: удалённые и «не растения». Можно посмотреть, вернуть, разметить или удалить навсегда. */
export async function hiddenView() {
  const [photos, deleted] = await Promise.all([photosByStatus('hidden'), deletedIds()]);
  photos.sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0) || b.takenAt - a.takenAt);
  for (const id of [...hiddenSel]) if (!photos.some((p) => p.id === id)) hiddenSel.delete(id);
  const page = h('div', { class: 'page' });
  page.append(h('a', { class: 'back-link', href: '#/more' }, icon('back', 20), 'Ещё'),
    h('header', { class: 'page-head tight' }, h('h1', null, 'Корзина'),
      h('p', { class: 'muted' }, 'Удалённые фото и «не растения». Их нет в разборе, сезонах и подсказках. Выберите фото, чтобы вернуть в разбор, сразу отметить или удалить навсегда.')));

  // Удалённые насовсем в прежних версиях: картинок в приложении нет — вернуть можно только из папки
  if (deleted.size) {
    const pick = (folder) => {
      const input = h('input', { type: 'file', multiple: true, accept: 'image/*', class: 'visually-hidden' });
      if (folder) input.webkitdirectory = true;
      input.addEventListener('change', () => {
        const list = [...input.files];
        if (list.length) { importFiles(list, { onlyDeleted: true }); toast('Ищу среди файлов удалённые раньше фото…'); }
      });
      document.body.append(input);
      input.click();
      setTimeout(() => input.remove(), 60000);
    };
    page.append(h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, `Удалены насовсем раньше: ${formatNumber(deleted.size)} ${plural(deleted.size, PHOTO_FORMS)}`),
      h('p', { class: 'muted small' }, 'Их картинок в приложении уже нет. Выберите папку или фото, откуда их загружали: приложение возьмёт только эти фото и положит их в разбор, остальное пропустит.'),
      h('div', { class: 'import-buttons' },
        h('button', { class: 'btn', type: 'button', onClick: () => pick(true) }, icon('folder', 20), 'Выбрать папку'),
        h('button', { class: 'btn', type: 'button', onClick: () => pick(false) }, icon('image', 20), 'Выбрать фото'))));
  }

  if (!photos.length) {
    page.append(h('p', { class: 'muted empty-note' }, 'Корзина пуста.'));
    return page;
  }
  page.append(h('p', { class: 'muted small' }, `В корзине: ${formatNumber(photos.length)} ${plural(photos.length, PHOTO_FORMS)}`));
  const grid = h('div', { class: 'photo-grid selectable' });
  const back = h('button', { class: 'btn primary', type: 'button' });
  const tag = h('button', { class: 'btn dark', type: 'button' }, 'Отметить…');
  const del = h('button', { class: 'btn ghost block', type: 'button' }, icon('trash', 18), 'Удалить навсегда');
  const refresh = () => {
    const n = hiddenSel.size;
    back.disabled = !n; tag.disabled = !n; del.disabled = !n;
    back.textContent = n ? `Вернуть в разбор (${formatNumber(n)})` : 'Выберите фото';
  };
  back.addEventListener('click', async () => {
    const ids = [...hiddenSel];
    await untrashPhotos(ids);
    hiddenSel.clear();
    toast(`Вернулось в разбор: ${formatNumber(ids.length)} ${plural(ids.length, PHOTO_FORMS)}`);
    rerender();
  });
  tag.addEventListener('click', () => {
    const chosen = photos.filter((p) => hiddenSel.has(p.id));
    openTagSheet({
      photos: chosen, mode: 'place',
      onApply: async (sel) => {
        const ids = chosen.map((p) => p.id);
        await tagPhotos(ids, sel);
        await untrashPhotos(ids);
        hiddenSel.clear();
        toast(`Размечено и возвращено из корзины: ${formatNumber(ids.length)} ${plural(ids.length, PHOTO_FORMS)}`);
        rerender();
      },
    });
  });
  del.addEventListener('click', async () => {
    const ids = [...hiddenSel];
    if (!confirmAction(`Удалить ${formatNumber(ids.length)} ${plural(ids.length, PHOTO_FORMS)} навсегда? Вернуть их можно будет только повторным импортом из папки.`)) return;
    await deletePhotos(ids);
    hiddenSel.clear();
    toast(`Удалено навсегда: ${formatNumber(ids.length)} ${plural(ids.length, PHOTO_FORMS)}`);
    rerender();
  });
  photos.forEach((p, idx) => {
    const tile = h('button', { class: `tile${hiddenSel.has(p.id) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(hiddenSel.has(p.id)) },
      photoImg(p.id), h('span', { class: 'tile-date' }, formatDayShort(p.takenAt)), h('span', { class: 'tile-check', 'aria-hidden': 'true' }, icon('check', 16)));
    tile.addEventListener('click', () => {
      if (hiddenSel.has(p.id)) hiddenSel.delete(p.id); else hiddenSel.add(p.id);
      tile.classList.toggle('on', hiddenSel.has(p.id));
      tile.setAttribute('aria-pressed', String(hiddenSel.has(p.id)));
      refresh();
    });
    const zoom = h('button', { class: 'tile-zoom', type: 'button', 'aria-label': 'Открыть крупно', onClick: () => openViewer(photos, idx, { onChange: () => rerender() }) }, icon('expand', 16));
    grid.append(h('div', { class: 'tile-wrap' }, tile, zoom));
  });
  page.classList.add('has-action-bar');
  page.append(grid, h('footer', { class: 'action-bar over-tabbar' }, h('div', { class: 'two-col' }, back, tag), del));
  refresh();
  return page;
}
