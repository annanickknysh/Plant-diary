// Сравнение двух фото: рядом или шторкой.
import { h, icon, clear, photoImg } from '../ui/dom.js';
import { imageURL } from '../data/images.js';
import { formatDate, formatTime, formatNumber, plural, PHOTO_FORMS } from '../lib/format.js';
import { catalog, plantName, placePath, varietyName } from '../data/store.js';
import { featuresFor } from '../data/similarity.js';
import { bestPairs, viewParts, plantOverlap } from '../lib/features.js';
import { loadVotes, setVote, feedbackState, pairKey } from '../data/viewFeedback.js';

function caption(p) {
  const what = p.plantIds.length
    ? p.plantIds.map((id) => plantName(catalog.plants.get(id))).join(', ')
    : p.placeIds.map((id) => placePath(id)).join(', ');
  return [formatDate(p.takenAt), what].filter(Boolean).join(' · ');
}

/**
 * @param opts.onBack — показать кнопку «← Другая пара» (вернуться к выбору пары)
 * @param opts.onClose — вызвать при закрытии крестиком
 */
export async function openCompare(a, b, { onBack = null, onClose = null, vote = null } = {}) {
  const [ua, ub] = await Promise.all([imageURL(a.id, 'f'), imageURL(b.id, 'f')]);
  // Старое фото — первым
  let [first, second, u1, u2] = a.takenAt <= b.takenAt ? [a, b, ua, ub] : [b, a, ub, ua];
  let mode = 'side';
  const prevFocus = document.activeElement;
  const overlay = h('div', { class: 'viewer compare', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Сравнение двух фото' });
  const body = h('div', { class: 'compare-body' });
  const remove = () => { overlay.remove(); document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); };
  const back = () => { remove(); onBack?.(); };
  const close = () => { remove(); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') (onBack ? back : close)(); };

  const seg = h('div', { class: 'segmented dark', role: 'group', 'aria-label': 'Вид сравнения' });
  const draw = () => {
    clear(seg).append(
      h('button', { type: 'button', 'aria-pressed': String(mode === 'side'), onClick: () => { mode = 'side'; draw(); } }, 'Рядом'),
      h('button', { type: 'button', 'aria-pressed': String(mode === 'slider'), onClick: () => { mode = 'slider'; draw(); } }, 'Шторка'));
    clear(body);
    if (mode === 'side') {
      body.className = 'compare-body side';
      body.append(
        h('figure', null, h('img', { src: u1, alt: caption(first) }), h('figcaption', null, caption(first))),
        h('figure', null, h('img', { src: u2, alt: caption(second) }), h('figcaption', null, caption(second))));
    } else {
      body.className = 'compare-body slider';
      const top = h('img', { src: u2, alt: caption(second), class: 'cmp-top' });
      const handle = h('div', { class: 'cmp-handle', 'aria-hidden': 'true' });
      const range = h('input', { type: 'range', min: '0', max: '100', value: '50', 'aria-label': 'Положение шторки' });
      const frame = h('div', { class: 'cmp-frame' }, h('img', { src: u1, alt: caption(first), class: 'cmp-bottom' }), top, handle);
      const set = (v) => { top.style.clipPath = `inset(0 0 0 ${v}%)`; handle.style.left = `${v}%`; };
      range.addEventListener('input', () => set(range.value));
      const drag = (e) => {
        const r = frame.getBoundingClientRect();
        const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        const v = Math.max(0, Math.min(100, (x / r.width) * 100));
        range.value = String(Math.round(v));
        set(v);
      };
      frame.addEventListener('pointerdown', (e) => { frame.setPointerCapture(e.pointerId); drag(e); });
      frame.addEventListener('pointermove', (e) => { if (e.buttons) drag(e); });
      set(50);
      body.append(frame, range, h('div', { class: 'cmp-captions' },
        h('span', null, `Слева: ${caption(first)}`), h('span', null, `Справа: ${caption(second)}`)));
    }
  };

  overlay.append(
    h('div', { class: 'viewer-top' },
      onBack ? h('button', { class: 'btn small cmp-back', type: 'button', onClick: back }, icon('back', 18), 'Пары') : null,
      seg,
      h('button', { class: 'icon-btn light', type: 'button', 'aria-label': 'Закрыть', onClick: close }, icon('close'))),
    body);
  if (vote) {
    let state = vote.get();
    const up = h('button', { class: 'icon-btn vote', type: 'button', 'aria-label': 'Хорошая пара' }, icon('up', 22));
    const down = h('button', { class: 'icon-btn vote', type: 'button', 'aria-label': 'Плохая пара' }, icon('down', 22));
    const label = h('span', null);
    const sync = () => {
      up.setAttribute('aria-pressed', String(state === true));
      down.setAttribute('aria-pressed', String(state === false));
      label.textContent = state === true ? 'Хорошая пара — закреплена в подсказках' : state === false ? 'Плохая пара — больше не предложу' : 'Удачная пара?';
    };
    const set = async (v) => { state = state === v ? null : v; sync(); await vote.set(state); };
    up.addEventListener('click', () => set(true));
    down.addEventListener('click', () => set(false));
    sync();
    overlay.append(h('div', { class: 'cmp-vote' }, label, up, down));
  }
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  draw();
  overlay.querySelector('.icon-btn')?.focus();
}

// Подпись — только по картинке (растения показываются отдельно)
const visual = (p) => (0.33 * p.lum + 0.27 * p.tex + 0.4 * p.full);
const scoreLabel = (s) => (s >= 0.9 ? 'ракурс почти совпадает' : s >= 0.7 ? 'похожий ракурс' : 'ракурс заметно отличается');

/**
 * Шаг между выбором двух периодов и сравнением: пары самых похожих ракурсов + свой выбор.
 * @param A, B — {label, photos}
 */
export async function openPairPicker(A, B) {
  // Раньше снятый период — слева
  if (Math.min(...B.photos.map((p) => p.takenAt)) < Math.min(...A.photos.map((p) => p.takenAt))) [A, B] = [B, A];
  const prevFocus = document.activeElement;
  const overlay = h('div', { class: 'viewer pairs', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Похожие ракурсы' });
  const body = h('div', { class: 'pairs-body' }, h('p', { class: 'muted' }, 'Ищу похожие ракурсы…'));
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape' && document.querySelector('.viewer:last-of-type') === overlay) close(); };
  overlay.append(
    h('div', { class: 'viewer-top' },
      h('div', { class: 'pairs-title' }, h('strong', null, 'Похожие ракурсы'), h('span', null, `${A.label} ↔ ${B.label}`)),
      h('button', { class: 'icon-btn light', type: 'button', 'aria-label': 'Закрыть', onClick: close }, icon('close'))),
    body);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);

  const byId = new Map([...A.photos, ...B.photos].map((p) => [p.id, p]));
  const feats = await featuresFor([...byId.keys()]);
  // Растения сравниваем по виду и сорту: тот же сорт, даже другой экземпляр, — совпадение
  const varieties = (p) => [...new Set((p.plantIds || []).map((id) => catalog.plants.get(id)).filter(Boolean).map((pl) => `${pl.speciesId}:${pl.cultivarId || ''}`))];
  const pick = (list) => list.filter((p) => feats.has(p.id)).map((p) => ({ id: p.id, f: feats.get(p.id), plants: varieties(p) }));
  const itemsA = pick(A.photos);
  const itemsB = pick(B.photos);
  let votes = await loadVotes();
  const voteOf = (a, b) => votes.find((v) => v.k === pairKey(a.id, b.id))?.good ?? null;
  const partsOf = (a, b) => {
    const fa = feats.get(a.id);
    const fb2 = feats.get(b.id);
    return fa && fb2 ? { ...viewParts(fa, fb2), plants: plantOverlap(varieties(a), varieties(b)) } : null;
  };
  const commonNames = (a, b) => {
    const vb = new Set(varieties(b));
    const names = [];
    for (const id of a.plantIds || []) {
      const pl = catalog.plants.get(id);
      if (pl && vb.has(`${pl.speciesId}:${pl.cultivarId || ''}`)) names.push(varietyName(pl));
    }
    return [...new Set(names)].join(', ');
  };
  const vote = async (a, b, good) => { votes = await setVote(a.id, b.id, good, partsOf(a, b)); };

  // Сравнение пары: с оценкой 👍/👎 внизу; после возврата список пересобирается с учётом оценки
  const show = (a, b) => openCompare(a, b, {
    onBack: () => draw(),
    onClose: close,
    vote: { get: () => voteOf(a, b), set: (good) => vote(a, b, good) },
  });

  const sel = { a: null, b: null, open: false };
  const thumb = (p) => h('span', { class: 'pair-photo' }, photoImg(p.id), h('span', { class: 'pair-date' }, `${formatDate(p.takenAt)}, ${formatTime(p.takenAt)}`));

  const draw = () => {
    const fb = feedbackState(votes);
    const pairs = bestPairs(itemsA, itemsB, 8, fb);
    clear(body);
    if (pairs.length) {
      body.append(h('p', { class: 'muted small' }, 'Нажмите на пару — откроется сравнение. Сверху самые похожие.'));
      const list = h('div', { class: 'pair-list' });
      const anyShared = pairs.some((pr) => pr.parts.plants > 0);
      const tagged = [...itemsA, ...itemsB].some((x) => x.plants.length);
      if (tagged && !anyShared) list.append(h('p', { class: 'muted small' }, 'В этих периодах нет фото с общими растениями — пары подобраны только по ракурсу.'));
      let dividerShown = false;
      for (const pr of pairs) {
        if (anyShared && !pr.liked && pr.parts.plants === 0 && !dividerShown) {
          dividerShown = true;
          list.append(h('h3', { class: 'eyebrow pair-divider' }, 'Без общих растений — только по ракурсу'));
        }
        const a = byId.get(pr.a);
        const b = byId.get(pr.b);
        let state = voteOf(a, b);
        const up = h('button', { class: 'icon-btn vote', type: 'button', 'aria-label': 'Хорошая пара' }, icon('up', 20));
        const down = h('button', { class: 'icon-btn vote', type: 'button', 'aria-label': 'Плохая пара' }, icon('down', 20));
        const note = h('span', { class: 'pair-score' });
        const row = h('div', { class: 'pair-row', dataset: { score: pr.score.toFixed(3) } },
          h('button', { class: 'pair-thumbs', type: 'button', 'aria-label': 'Сравнить эту пару', onClick: () => show(a, b) }, thumb(a), thumb(b)),
          h('div', { class: 'pair-foot' }, note, up, down));
        const sync = () => {
          up.setAttribute('aria-pressed', String(state === true));
          down.setAttribute('aria-pressed', String(state === false));
          row.classList.toggle('rejected', state === false);
          note.className = `pair-score${state === false ? '' : visual(pr.parts) >= 0.7 || state ? ' good' : ''}`;
          const shared = pr.parts.plants > 0 ? commonNames(a, b) : '';
          const plants = shared ? ` · общие: ${shared}` : '';
          note.textContent = state === true ? 'закреплена — буду ставить выше'
            : state === false ? 'больше не предложу эту пару'
              : `${scoreLabel(visual(pr.parts))}${plants}`;
        };
        const onVote = async (v) => {
          state = state === v ? null : v;
          sync();
          await vote(a, b, state);
          drawStatus();
        };
        up.addEventListener('click', () => onVote(true));
        down.addEventListener('click', () => onVote(false));
        sync();
        list.append(row);
      }
      body.append(list);
    } else {
      body.append(h('p', { class: 'muted' }, 'Не удалось сравнить ракурсы — выберите фото сами.'));
    }
    const status = h('p', { class: 'muted small pair-status' });
    const drawStatus = () => {
      const st = feedbackState(votes);
      status.textContent = st.tuned
        ? `Оценок: ${formatNumber(st.count)}. Подбор уже подстроен под ваши оценки.`
        : `👍 и 👎 помогают подбору: оценённые пары запоминаются, а после 8 оценок (нужны и 👍, и 👎) подбор подстроится под ваши фото. Сейчас оценок: ${formatNumber(st.count)}.`;
    };
    drawStatus();
    body.append(status);

    // Свой выбор: по одному фото из каждого периода; пару можно сравнить или закрепить в подсказках
    const go = h('button', { class: 'btn primary', type: 'button', onClick: () => show(sel.a, sel.b) }, 'Сравнить');
    const pin = h('button', {
      class: 'btn', type: 'button',
      onClick: async () => { await vote(sel.a, sel.b, true); sel.a = null; sel.b = null; draw(); body.scrollTop = 0; },
    }, icon('up', 18), 'Закрепить в подсказках');
    const syncBtns = () => { go.disabled = !(sel.a && sel.b); pin.disabled = go.disabled; };
    const strip = (side, P) => {
      const row = h('div', { class: 'thumb-strip pair-strip' });
      for (const p of [...P.photos].sort((x, y) => x.takenAt - y.takenAt)) {
        const t = h('button', { class: 'thumb', type: 'button', 'aria-pressed': String(sel[side]?.id === p.id), 'aria-label': `${P.label}: ${formatDate(p.takenAt)}` }, photoImg(p.id));
        t.addEventListener('click', () => {
          sel[side] = p;
          row.querySelectorAll('.thumb').forEach((x) => x.setAttribute('aria-pressed', String(x === t)));
          syncBtns();
        });
        row.append(t);
      }
      return h('div', { class: 'pair-side' }, h('span', { class: 'small' }, `${P.label} · ${formatNumber(P.photos.length)} ${plural(P.photos.length, PHOTO_FORMS)}`), row);
    };
    const det = h('details', { class: 'pair-manual', open: sel.open || !pairs.length },
      h('summary', null, 'Выбрать фото вручную'),
      strip('a', A), strip('b', B), h('div', { class: 'row-buttons' }, go, pin));
    det.addEventListener('toggle', () => { sel.open = det.open; });
    syncBtns();
    body.append(det);
  };
  draw();
}
