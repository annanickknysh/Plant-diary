// Экран «Ещё»: импорт, хранилище, скрытые фото, настройки.
import { h, icon, photoImg, toast } from '../ui/dom.js';
import { countPhotos, getSetting, setSetting, photosByStatus, unhidePhotos } from '../data/store.js';
import { importButtons } from '../ui/importButtons.js';
import { formatNumber, formatBytes, formatDayShort, plural, PHOTO_FORMS } from '../lib/format.js';
import { rerender } from '../app.js';

export const APP_VERSION = '0.3.0';

export async function moreView() {
  const [counts, gap, quality, estimate, persisted] = await Promise.all([
    countPhotos(),
    getSetting('walkGapMinutes'),
    getSetting('fullQuality'),
    navigator.storage?.estimate?.().catch(() => null),
    navigator.storage?.persisted?.().catch(() => null),
  ]);
  const page = h('div', { class: 'page' });
  page.append(h('header', { class: 'page-head' }, h('h1', null, 'Ещё')));

  page.append(h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Добавить фото'),
    h('p', { class: 'muted' }, 'Дубли распознаются автоматически, поэтому одну и ту же папку можно выбирать повторно — например, если импорт прервался.'),
    importButtons()));

  page.append(h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Фото'),
    h('dl', { class: 'stats' },
      h('dt', null, 'Всего'), h('dd', null, formatNumber(counts.total)),
      h('dt', null, 'Разобрано'), h('dd', null, formatNumber(counts.tagged)),
      h('dt', null, 'Ждут разбора'), h('dd', null, formatNumber(counts.fresh)),
      h('dt', null, 'Скрыто («не растение»)'), h('dd', null, formatNumber(counts.hidden))),
    counts.hidden ? h('a', { class: 'btn block', href: '#/hidden' }, 'Посмотреть скрытые') : null));

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

  page.append(h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Скоро'),
    h('p', { class: 'muted' }, 'Резервная копия и перенос между компьютером и телефоном одним файлом появятся в версии с дневником.')),
  h('p', { class: 'muted center small' }, `Дневник растений · версия ${APP_VERSION}`));
  return page;
}

const hiddenSel = new Set();

export async function hiddenView() {
  const photos = (await photosByStatus('hidden')).sort((a, b) => b.takenAt - a.takenAt);
  const page = h('div', { class: 'page' });
  page.append(h('a', { class: 'back-link', href: '#/more' }, icon('back', 20), 'Ещё'),
    h('header', { class: 'page-head tight' }, h('h1', null, 'Скрытые фото'), h('p', { class: 'muted' }, 'Выберите фото, которые нужно вернуть в разбор.')));
  if (!photos.length) {
    page.append(h('p', { class: 'muted empty-note' }, 'Скрытых фото нет.'));
    return page;
  }
  const grid = h('div', { class: 'photo-grid selectable' });
  const btn = h('button', {
    class: 'btn primary block', type: 'button',
    onClick: async () => {
      const ids = [...hiddenSel];
      await unhidePhotos(ids);
      hiddenSel.clear();
      toast(`Возвращено: ${formatNumber(ids.length)} ${plural(ids.length, PHOTO_FORMS)}`);
      rerender();
    },
  });
  const refresh = () => {
    btn.disabled = !hiddenSel.size;
    btn.textContent = hiddenSel.size ? `Вернуть в разбор (${formatNumber(hiddenSel.size)})` : 'Выберите фото';
  };
  for (const p of photos) {
    const tile = h('button', { class: `tile${hiddenSel.has(p.id) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(hiddenSel.has(p.id)) },
      photoImg(p.id), h('span', { class: 'tile-date' }, formatDayShort(p.takenAt)), h('span', { class: 'tile-check', 'aria-hidden': 'true' }, icon('check', 16)));
    tile.addEventListener('click', () => {
      if (hiddenSel.has(p.id)) hiddenSel.delete(p.id); else hiddenSel.add(p.id);
      tile.classList.toggle('on', hiddenSel.has(p.id));
      tile.setAttribute('aria-pressed', String(hiddenSel.has(p.id)));
      refresh();
    });
    grid.append(h('div', { class: 'tile-wrap' }, tile));
  }
  page.classList.add('has-action-bar');
  page.append(grid, h('footer', { class: 'action-bar over-tabbar' }, btn));
  refresh();
  return page;
}
