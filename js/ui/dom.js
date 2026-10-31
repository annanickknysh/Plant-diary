// Небольшие помощники для построения интерфейса без фреймворка.
import { imageURL } from '../data/images.js';

/** h('div', {class: 'x', onClick: fn}, 'текст', child) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

const ICONS = {
  inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5.5 5h13L21 13v6H3v-6z"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  leaf: '<path d="M5 19C5 10.5 10.5 5 19 5c0 8.5-5.5 14-14 14z"/><path d="M5 19l7.5-7.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-9 8.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
};

export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

// ---------- ленивые изображения ----------

const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      loadInto(e.target);
    }
  }, { rootMargin: '400px' })
  : null;

async function loadInto(img) {
  const url = await imageURL(img.dataset.photo, img.dataset.kind || 't');
  if (url) img.src = url;
  else img.classList.add('missing');
}

/** <img> превью фото, которое подгружается при прокрутке. */
export function photoImg(photoId, kind = 't', props = {}) {
  const img = h('img', { alt: '', decoding: 'async', draggable: 'false', ...props, dataset: { photo: photoId, kind } });
  if (io) io.observe(img);
  else loadInto(img);
  return img;
}

// ---------- всплывающие сообщения ----------

let toastTimer = null;
export function toast(message, { actionLabel, onAction, duration = 4000 } = {}) {
  let host = document.getElementById('toast');
  if (!host) {
    host = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  clear(host);
  host.append(h('span', null, message));
  if (actionLabel) {
    host.append(h('button', { class: 'toast-action', onClick: () => { hide(); onAction?.(); } }, actionLabel));
  }
  host.classList.add('show');
  clearTimeout(toastTimer);
  const hide = () => host.classList.remove('show');
  toastTimer = setTimeout(hide, duration);
}

// ---------- нижняя панель (sheet) ----------

/** Открыть нижнюю панель. build(close) возвращает содержимое. */
export function openSheet(build, { label = 'Панель', tall = false } = {}) {
  const prevFocus = document.activeElement;
  const overlay = h('div', { class: 'sheet-overlay' });
  const sheet = h('section', { class: `sheet${tall ? ' tall' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  sheet.append(h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }), build(close));
  overlay.append(sheet);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return { close, sheet };
}

/** Форма в нижней панели. fields: [{name, label, type, value, options, placeholder, required}] */
export function formSheet({ title, fields, submitLabel = 'Сохранить', onSubmit }) {
  openSheet((close) => {
    const form = h('form', { class: 'form' });
    const inputs = {};
    form.append(h('h2', { class: 'sheet-title' }, title));
    for (const f of fields) {
      const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
      let input;
      if (f.type === 'select') {
        input = h('select', { id, name: f.name }, f.options.map((o) => h('option', { value: o.value, selected: o.value === f.value }, o.label)));
      } else if (f.type === 'textarea') {
        input = h('textarea', { id, name: f.name, rows: 3, placeholder: f.placeholder || '' });
        input.value = f.value || '';
      } else {
        input = h('input', { id, name: f.name, type: f.type || 'text', placeholder: f.placeholder || '', required: f.required || false, autocomplete: 'off' });
        input.value = f.value ?? '';
      }
      inputs[f.name] = input;
      form.append(h('label', { class: 'field', for: id }, h('span', null, f.label), input));
    }
    const err = h('p', { class: 'form-error', role: 'alert' });
    form.append(err, h('button', { class: 'btn primary block', type: 'submit' }, submitLabel));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
      try {
        await onSubmit(values);
        close();
      } catch (ex) {
        err.textContent = ex.message || String(ex);
      }
    });
    setTimeout(() => form.querySelector('input,select,textarea')?.focus(), 50);
    return form;
  }, { label: title });
}

export function confirmAction(text) {
  return window.confirm(text);
}
