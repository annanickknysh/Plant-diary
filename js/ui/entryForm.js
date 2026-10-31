// Форма записи дневника и список записей.
import { h, icon, formSheet, toast, confirmAction } from './dom.js';
import { ENTRY_TYPES, entryTypeLabel, saveEntry, deleteEntry, entryTargetName } from '../data/store.js';
import { openTagSheet } from '../views/tagSheet.js';
import { formatDate } from '../lib/format.js';

const pad = (x) => String(x).padStart(2, '0');
const toInputDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fromInputDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };

/** Поле «к чему относится запись»: растение или место. */
function targetField(initial) {
  let cur = { plantId: initial.plantId || null, placeId: initial.placeId || null };
  const text = h('span', { class: 'place-field-text' });
  const btn = h('button', { class: 'place-field', type: 'button' }, text, icon('chevron', 18));
  const draw = () => { text.textContent = cur.plantId || cur.placeId ? entryTargetName(cur) : 'Весь сад'; };
  btn.addEventListener('click', () => openTagSheet({
    photos: [], mode: cur.placeId && !cur.plantId ? 'place' : 'plant', singlePlant: true,
    title: 'К чему относится запись', cta: 'Выбрать',
    onApply: async (sel) => {
      cur = sel.plantIds?.length ? { plantId: sel.plantIds[0], placeId: null } : { plantId: null, placeId: sel.placeId };
      draw();
    },
  }));
  draw();
  return { el: btn, get: () => cur };
}

/**
 * Открыть форму записи.
 * @param entry — существующая запись или заготовка {type, plantId, placeId, date}
 */
export function openEntryForm(entry = {}, { onSaved } = {}) {
  const isNew = !entry.id;
  formSheet({
    title: isNew ? 'Новая запись' : 'Запись',
    fields: [
      { name: 'type', label: 'Что произошло', type: 'select', value: entry.type || 'note', options: ENTRY_TYPES.map((t) => ({ value: t.key, label: t.label })) },
      { name: 'date', label: 'Когда', type: 'date', value: toInputDate(entry.date || Date.now()), required: true },
      { name: 'target', label: 'К чему относится', type: 'custom', build: () => targetField(entry) },
      { name: 'text', label: 'Заметка', type: 'textarea', value: entry.text || '', placeholder: 'Например: первые бутоны, подкормила азофоской' },
    ],
    submitLabel: isNew ? 'Добавить запись' : 'Сохранить',
    onSubmit: async (v) => {
      if (!v.date) throw new Error('Укажите дату.');
      const saved = await saveEntry({ ...entry, type: v.type, date: fromInputDate(v.date), text: v.text.trim(), plantId: v.target.plantId, placeId: v.target.placeId });
      toast(isNew ? 'Запись добавлена' : 'Запись сохранена');
      onSaved?.(saved);
    },
  });
}

/** Быстрая запись в одно касание (например, «Зацвело сегодня»). */
export async function quickEntry(type, target, onSaved) {
  const e = await saveEntry({ type, date: Date.now(), text: '', plantId: target.plantId || null, placeId: target.placeId || null });
  toast(`${entryTypeLabel(type)}: запись на сегодня`, {
    actionLabel: 'Отменить', duration: 8000, onAction: async () => { await deleteEntry(e.id); onSaved?.(); },
  });
  onSaved?.();
}

/** Список записей. showTarget — показывать, к чему относится запись. */
export function entryList(entries, { showTarget = true, onChange } = {}) {
  if (!entries.length) return h('p', { class: 'muted empty-note' }, 'Записей пока нет.');
  return h('div', { class: 'entry-list' }, entries.map((e) => h('div', { class: 'entry' },
    h('button', { class: 'entry-main', type: 'button', onClick: () => openEntryForm(e, { onSaved: onChange }) },
      h('span', { class: `entry-type t-${e.type}` }, entryTypeLabel(e.type)),
      h('span', { class: 'entry-date' }, formatDate(e.date)),
      showTarget ? h('span', { class: 'entry-target' }, entryTargetName(e)) : null,
      e.text ? h('span', { class: 'entry-text' }, e.text) : null),
    h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'Удалить запись',
      onClick: async () => {
        if (!confirmAction('Удалить эту запись?')) return;
        await deleteEntry(e.id);
        toast('Запись удалена');
        onChange?.();
      },
    }, icon('trash', 18)))));
}

