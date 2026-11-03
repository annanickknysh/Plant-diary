// Карточка «Помощник распознавания» на экране «Ещё».
import { h, clear } from './dom.js';
import { indexState, indexAll, evaluate, MIN_LABELED } from '../data/similarity.js';
import { getSetting, setSetting, bus, countPhotos } from '../data/store.js';
import { nnState, nnRun, nnPause, nnCount } from '../data/nnIndex.js';
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

  // ---------- нейросеть ----------
  const nnOn = (await getSetting('nnEnabled')) === true;
  const nnToggle = h('input', { type: 'checkbox', id: 'nn-on', checked: nnOn });
  const nnInfo = h('p', { class: 'muted small nn-status' });
  const nnPauseBtn = h('button', { class: 'btn small', type: 'button', hidden: true, onClick: () => nnPause(!nnState.paused) });
  const drawNN = async () => {
    const st = nnState;
    nnPauseBtn.hidden = !nnToggle.checked || (!st.running && !st.paused) || st.done >= st.total;
    nnPauseBtn.textContent = st.paused ? 'Продолжить' : 'Пауза';
    if (!nnToggle.checked) { nnInfo.textContent = 'Выключена — подсказки работают по-прежнему.'; return; }
    if (st.error) { nnInfo.textContent = `Не удалось запустить: ${st.error}. Проверьте интернет — модель скачивается один раз.`; return; }
    const left = Math.max(0, st.total - st.done);
    const eta = st.msPerPhoto && left ? ` · осталось примерно ${Math.max(1, Math.round((left * st.msPerPhoto) / 60000))} мин` : '';
    if (st.paused) nnInfo.textContent = `На паузе: обработано ${formatNumber(st.done)} из ${formatNumber(st.total)} фото.`;
    else if (st.running) nnInfo.textContent = `Изучаю фото: ${formatNumber(st.done)} из ${formatNumber(st.total)}${eta}. Можно пользоваться приложением; если закрыть — продолжу с того же места.`;
    else nnInfo.textContent = st.total ? `Готово: нейросеть изучила ${formatNumber(st.done)} фото. Подсказки идут от неё.` : `Изучено фото: ${formatNumber(await nnCount())}.`;
  };
  nnToggle.addEventListener('change', async () => {
    await setSetting('nnEnabled', nnToggle.checked);
    nnState.enabled = nnToggle.checked;
    if (nnToggle.checked) { nnState.paused = false; nnRun(); }
    drawNN();
  });
  const onNN = () => { if (!nnInfo.isConnected) { bus.removeEventListener('nn', onNN); return; } drawNN(); };
  bus.addEventListener('nn', onNN);
  drawNN();
  if (nnOn && !nnState.running) nnRun();

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
        const row = (label, key) => {
          const cells = [h('th', null, label), h('td', null, pct(r[key].top1, r[key].n)), h('td', null, pct(r[key].top3, r[key].n))];
          if (r.nn) cells.push(h('td', { class: 'nn-col' }, pct(r.nn[key].top1, r.nn[key].n)), h('td', { class: 'nn-col' }, pct(r.nn[key].top3, r.nn[key].n)));
          cells.push(h('td', null, formatNumber(r[key].n)));
          return h('tr', null, cells);
        };
        const head = r.nn
          ? [h('tr', null, h('th', null, ''), h('th', { colspan: 2 }, 'Прежний'), h('th', { colspan: 2, class: 'nn-col' }, 'Нейросеть'), h('th', null, '')),
            h('tr', null, h('th', null, ''), h('th', null, '1-я'), h('th', null, 'из 3'), h('th', { class: 'nn-col' }, '1-я'), h('th', { class: 'nn-col' }, 'из 3'), h('th', null, 'фото'))]
          : [h('tr', null, h('th', null, ''), h('th', null, 'с первого раза'), h('th', null, 'среди 3 подсказок'), h('th', null, 'фото'))];
        clear(result).append(
          h('p', null, r.nn
            ? 'Обе модели по очереди угадывали одни и те же ваши размеченные фото по остальным (без кадров той же прогулки).'
            : 'Помощник по очереди угадывал ваши размеченные фото по остальным (без кадров той же прогулки).'),
          h('table', { class: `acc-table${r.nn ? ' two' : ''}` },
            h('thead', null, head),
            h('tbody', null, row('Клумба или вид', 'place'), row('Растение', 'plant'), row('Растение, когда клумба уже выбрана', 'plantInBed'))),
          r.nn ? null : (nnToggle.checked ? h('p', { class: 'muted small' }, `Нейросеть пока изучила ${formatNumber(r.nnCount)} размеченных фото — сравнение появится, когда их будет хотя бы ${MIN_LABELED}.`) : null),
          h('p', { class: 'muted small' }, '«1-я» — верная подсказка стоит первой, «из 3» — она среди трёх. Подсказки всё равно нужно подтверждать — это помощь, а не автоматическая разметка.'));
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
    progress,
    h('div', { class: 'nn-box' },
      h('label', { class: 'check', for: 'nn-on' }, nnToggle, h('span', null, h('strong', null, 'Нейросеть'), ' — точнее узнаёт растения и места. Скачает модель 4,4 МБ один раз и изучит все фото в фоне, примерно секунда на фото.')),
      nnInfo, nnPauseBtn),
    btn, result);
}
