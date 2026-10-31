// Сравнение двух фото: рядом или шторкой.
import { h, icon, clear } from '../ui/dom.js';
import { imageURL } from '../data/images.js';
import { formatDate } from '../lib/format.js';
import { catalog, plantName, placePath } from '../data/store.js';

function caption(p) {
  const what = p.plantIds.length
    ? p.plantIds.map((id) => plantName(catalog.plants.get(id))).join(', ')
    : p.placeIds.map((id) => placePath(id)).join(', ');
  return [formatDate(p.takenAt), what].filter(Boolean).join(' · ');
}

export async function openCompare(a, b) {
  const [ua, ub] = await Promise.all([imageURL(a.id, 'f'), imageURL(b.id, 'f')]);
  // Старое фото — первым
  let [first, second, u1, u2] = a.takenAt <= b.takenAt ? [a, b, ua, ub] : [b, a, ub, ua];
  let mode = 'side';
  const prevFocus = document.activeElement;
  const overlay = h('div', { class: 'viewer compare', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Сравнение двух фото' });
  const body = h('div', { class: 'compare-body' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

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
    h('div', { class: 'viewer-top' }, seg,
      h('button', { class: 'icon-btn light', type: 'button', 'aria-label': 'Закрыть', onClick: close }, icon('close'))),
    body);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  draw();
  overlay.querySelector('.icon-btn')?.focus();
}
