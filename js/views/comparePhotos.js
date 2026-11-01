// Сравнение двух фото: рядом или шторкой.
import { h, icon, clear, photoImg } from '../ui/dom.js';
import { imageURL } from '../data/images.js';
import { formatDate, formatTime, formatNumber, plural, PHOTO_FORMS } from '../lib/format.js';
import { catalog, plantName, placePath } from '../data/store.js';
import { featuresFor } from '../data/similarity.js';
import { bestPairs } from '../lib/features.js';

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
export async function openCompare(a, b, { onBack = null, onClose = null } = {}) {
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
      onBack ? h('button', { class: 'btn small cmp-back', type: 'button', onClick: back }, icon('back', 18), 'Другая пара') : null,
      seg,
      h('button', { class: 'icon-btn light', type: 'button', 'aria-label': 'Закрыть', onClick: close }, icon('close'))),
    body);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  draw();
  overlay.querySelector('.icon-btn')?.focus();
}

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
  const show = (a, b) => openCompare(a, b, { onBack: () => {}, onClose: close });
  overlay.append(
    h('div', { class: 'viewer-top' },
      h('div', { class: 'pairs-title' }, h('strong', null, 'Похожие ракурсы'), h('span', null, `${A.label} ↔ ${B.label}`)),
      h('button', { class: 'icon-btn light', type: 'button', 'aria-label': 'Закрыть', onClick: close }, icon('close'))),
    body);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);

  const byId = new Map([...A.photos, ...B.photos].map((p) => [p.id, p]));
  const feats = await featuresFor([...byId.keys()]);
  const pick = (list) => list.filter((p) => feats.has(p.id)).map((p) => ({ id: p.id, f: feats.get(p.id) }));
  const pairs = bestPairs(pick(A.photos), pick(B.photos), 8);

  clear(body);
  const thumb = (p) => h('span', { class: 'pair-photo' }, photoImg(p.id), h('span', { class: 'pair-date' }, `${formatDate(p.takenAt)}, ${formatTime(p.takenAt)}`));
  if (pairs.length) {
    body.append(h('p', { class: 'muted small' }, 'Выберите пару — откроется сравнение. Сверху самые похожие.'));
    const list = h('div', { class: 'pair-list' });
    for (const pr of pairs) {
      const a = byId.get(pr.a);
      const b = byId.get(pr.b);
      list.append(h('button', { class: 'pair-row', type: 'button', dataset: { score: pr.score.toFixed(3) }, onClick: () => show(a, b) },
        h('span', { class: 'pair-thumbs' }, thumb(a), thumb(b)),
        h('span', { class: `pair-score${pr.score >= 0.7 ? ' good' : ''}` }, scoreLabel(pr.score))));
    }
    body.append(list);
  } else {
    body.append(h('p', { class: 'muted' }, 'Не удалось сравнить ракурсы — выберите фото сами.'));
  }

  // Свой выбор: по одному фото из каждого периода
  const sel = { a: null, b: null };
  const go = h('button', { class: 'btn primary block', type: 'button', disabled: true, onClick: () => show(sel.a, sel.b) }, 'Сравнить выбранные');
  const strip = (side, P) => {
    const row = h('div', { class: 'thumb-strip pair-strip' });
    for (const p of [...P.photos].sort((x, y) => x.takenAt - y.takenAt)) {
      const t = h('button', { class: 'thumb', type: 'button', 'aria-pressed': 'false', 'aria-label': `${P.label}: ${formatDate(p.takenAt)}` }, photoImg(p.id));
      t.addEventListener('click', () => {
        sel[side] = p;
        row.querySelectorAll('.thumb').forEach((x) => x.setAttribute('aria-pressed', String(x === t)));
        go.disabled = !(sel.a && sel.b);
      });
      row.append(t);
    }
    return h('div', { class: 'pair-side' }, h('span', { class: 'small' }, `${P.label} · ${formatNumber(P.photos.length)} ${plural(P.photos.length, PHOTO_FORMS)}`), row);
  };
  body.append(h('details', { class: 'pair-manual', open: !pairs.length },
    h('summary', null, 'Выбрать фото вручную'),
    strip('a', A), strip('b', B), go));
}
