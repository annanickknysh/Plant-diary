// Карточка «Помощник распознавания» на экране «Ещё».
import { h, clear } from './dom.js';
import { indexState, indexAll, evaluate, MIN_LABELED } from '../data/similarity.js';
import { getSetting, setSetting, bus, countPhotos } from '../data/store.js';
import { formatNumber } from '../lib/format.js';

const pct = (a, n) => (n ? `${Math.round((a / n) * 100)}%` : '—');

export async function assistantCard() {
  const [on, counts] = await Promise.all([getSetting('suggestions'), countPhotos()]);
  const enabled = on !== false;
  const progress = h('p', { class: 'muted small' });
  const drawProgress = () => {
    const st = indexState;
    progress.textContent = st.running
      ? `Готовлю отпечатки фото: ${formatNumber(st.done)} из ${formatNumber(st.total)}. Это идёт в фоне.`
      : st.total ? `Отпечатки готовы для ${formatNumber(st.done)} фото.` : '';
  };
  drawProgress();
  const onFeat = () => { if (!progress.isConnected) { bus.removeEventListener('features', onFeat); return; } drawProgress(); };
  bus.addEventListener('features', onFeat);

  const toggle = h('input', { type: 'checkbox', id: 'sugg-on', checked: enabled });
  toggle.addEventListener('change', () => setSetting('suggestions', toggle.checked));

  const result = h('div', { class: 'backup-status', role: 'status', 'aria-live': 'polite' });
  const btn = h('button', {
    class: 'btn', type: 'button', disabled: counts.tagged < MIN_LABELED,
    onClick: async () => {
      btn.disabled = true;
      clear(result).append(h('p', null, 'Считаю…'));
      try {
        await indexAll();
        const r = await evaluate({
          onProgress: (i, n) => { clear(result).append(h('p', null, `Проверяю: ${formatNumber(i)} из ${formatNumber(n)} фото`)); },
        });
        clear(result).append(
          h('p', null, `Помощник по очереди угадывал ваши размеченные фото по остальным (без кадров той же прогулки).`),
          h('table', { class: 'acc-table' },
            h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'с первого раза'), h('th', null, 'среди 3 подсказок'), h('th', null, 'фото'))),
            h('tbody', null,
              h('tr', null, h('th', null, 'Клумба или вид'), h('td', null, pct(r.place.top1, r.place.n)), h('td', null, pct(r.place.top3, r.place.n)), h('td', null, formatNumber(r.place.n))),
              h('tr', null, h('th', null, 'Растение'), h('td', null, pct(r.plant.top1, r.plant.n)), h('td', null, pct(r.plant.top3, r.plant.n)), h('td', null, formatNumber(r.plant.n))))),
          h('p', { class: 'muted small' }, 'Чем больше размечено разных сезонов и ракурсов, тем выше точность. Подсказки всё равно нужно подтверждать — это помощь, а не автоматическая разметка.'));
      } catch (e) {
        clear(result).append(h('p', { class: 'form-error' }, e.message || String(e)));
      }
      btn.disabled = false;
    },
  }, 'Проверить точность');

  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Помощник распознавания'),
    h('p', { class: 'muted' }, 'При отметке фото помощник сравнивает их с уже размеченными и предлагает «Похоже на…». Всё считается на устройстве, без интернета.'),
    h('label', { class: 'check', for: 'sugg-on' }, toggle, h('span', null, 'Показывать подсказки «Похоже на…»')),
    counts.tagged < MIN_LABELED ? h('p', { class: 'muted small' }, `Подсказки появятся, когда будет размечено хотя бы ${MIN_LABELED} фото.`) : null,
    progress, btn, result);
}
