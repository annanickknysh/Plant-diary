// Выбор вида и сорта: поиск, «Создать «…»» с текстом из поиска, исправление названия.
import { h, icon, clear, openSheet, formSheet, toast } from './dom.js';
import { catalog, createSpecies, createCultivar, updateEntity } from '../data/store.js';

const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const byName = (a, b) => a.name.localeCompare(b.name, 'ru');

/**
 * Панель выбора из списка с поиском.
 * items(): [{id, name, sub}] — пересчитывается после переименования.
 */
function openListPicker({ title, value, items, noneLabel = null, searchPlaceholder, createLabel, onCreate, onRename, onPick }) {
  openSheet((close) => {
    let query = '';
    const root = h('div', { class: 'tag-sheet list-picker' });
    const search = h('input', { type: 'search', placeholder: searchPlaceholder, 'aria-label': 'Поиск', autocomplete: 'off' });
    const body = h('div', { class: 'tag-lists' });
    root.append(
      h('div', { class: 'sheet-header' }, h('h2', { class: 'sheet-title' }, title),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onClick: close }, icon('close'))),
      h('label', { class: 'search' }, icon('search', 18), search), body);

    const pick = (id) => { close(); onPick(id); };
    const row = (it) => {
      const on = it.id === value;
      return h('div', { class: 'pick-line' },
        h('button', { class: `pick-row${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), onClick: () => pick(it.id) },
          h('span', { class: 'pick-text' }, h('span', { class: 'pick-title' }, it.name), it.sub ? h('span', { class: 'pick-sub' }, it.sub) : null),
          on ? icon('check', 22) : null),
        onRename ? h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': `Исправить название «${it.name}»`,
          onClick: () => renameSheet(it, onRename, draw),
        }, icon('edit', 18)) : null);
    };

    const draw = () => {
      clear(body);
      const q = norm(query);
      const all = items();
      const found = q ? all.filter((it) => norm(it.name).includes(q)) : all;
      if (!q && noneLabel) {
        const on = !value;
        body.append(h('button', { class: `pick-row${on ? ' on' : ''}`, type: 'button', onClick: () => pick(null) },
          h('span', { class: 'pick-text' }, h('span', { class: 'pick-title' }, noneLabel)), on ? icon('check', 22) : null));
      }
      found.forEach((it) => body.append(row(it)));
      const exact = all.some((it) => norm(it.name) === q);
      if (q && !found.length) body.append(h('p', { class: 'muted' }, 'Ничего не нашлось.'));
      if (q && !exact) {
        const name = query.trim().replace(/\s+/g, ' ');
        const text = `${name[0].toUpperCase()}${name.slice(1)}`;
        body.append(h('button', {
          class: 'btn dashed block', type: 'button',
          onClick: async () => { const id = await onCreate(text); pick(id); },
        }, icon('plus', 20), `${createLabel} «${text}»`));
      } else if (!q) {
        body.append(h('p', { class: 'muted small' }, 'Нет нужного? Начните вводить название в поиске — появится кнопка «Создать».'));
      }
    };
    search.addEventListener('input', () => { query = search.value; draw(); });
    draw();
    setTimeout(() => search.focus(), 50);
    return root;
  }, { label: title, tall: true });
}

function renameSheet(it, onRename, redraw) {
  formSheet({
    title: 'Исправить название',
    fields: [{ name: 'name', label: 'Название', value: it.name, required: true }],
    onSubmit: async (v) => {
      const name = v.name.trim();
      if (!name) throw new Error('Введите название.');
      await onRename(it.id, name);
      toast('Название исправлено — на всех фото тоже');
      redraw();
    },
  });
}

function fieldButton(onClick) {
  const text = h('span', { class: 'place-field-text' });
  const btn = h('button', { class: 'place-field', type: 'button', onClick }, text, icon('chevron', 18));
  return { btn, text };
}

/**
 * Поля «Вид» и «Сорт» для формы растения. Возвращает два custom-поля для formSheet.
 */
export function varietyFields({ speciesId = null, cultivarId = null } = {}) {
  const st = { speciesId, cultivarId };

  const sp = fieldButton(() => openListPicker({
    title: 'Вид',
    value: st.speciesId,
    searchPlaceholder: 'Найти или ввести новый вид',
    items: () => [...catalog.species.values()].sort(byName).map((s) => ({ id: s.id, name: s.name, sub: s.latin || '' })),
    createLabel: 'Создать вид',
    onCreate: async (name) => {
      const ex = [...catalog.species.values()].find((s) => norm(s.name) === norm(name));
      return (ex || await createSpecies({ name })).id;
    },
    onRename: async (id, name) => updateEntity('species', { ...catalog.species.get(id), name }),
    onPick: (id) => {
      if (id !== st.speciesId) st.cultivarId = null;
      st.speciesId = id;
      draw();
    },
  }));

  const cv = fieldButton(() => {
    if (!st.speciesId) { toast('Сначала выберите вид'); return; }
    openListPicker({
      title: `Сорт · ${catalog.species.get(st.speciesId)?.name || ''}`,
      value: st.cultivarId,
      noneLabel: 'Без сорта',
      searchPlaceholder: 'Найти или ввести новый сорт',
      items: () => [...catalog.cultivars.values()].filter((c) => c.speciesId === st.speciesId).sort(byName).map((c) => ({ id: c.id, name: c.name })),
      createLabel: 'Создать сорт',
      onCreate: async (name) => {
        const ex = [...catalog.cultivars.values()].find((c) => c.speciesId === st.speciesId && norm(c.name) === norm(name));
        return (ex || await createCultivar({ speciesId: st.speciesId, name })).id;
      },
      onRename: async (id, name) => updateEntity('cultivars', { ...catalog.cultivars.get(id), name }),
      onPick: (id) => { st.cultivarId = id; draw(); },
    });
  });

  const draw = () => {
    sp.text.textContent = st.speciesId ? catalog.species.get(st.speciesId)?.name || '—' : 'Выберите вид';
    sp.btn.classList.toggle('empty', !st.speciesId);
    cv.text.textContent = st.cultivarId ? catalog.cultivars.get(st.cultivarId)?.name || '—' : 'Без сорта';
  };
  draw();

  return {
    species: { name: 'speciesId', label: 'Вид', type: 'custom', build: () => ({ el: sp.btn, get: () => st.speciesId }) },
    cultivar: { name: 'cultivarId', label: 'Сорт', type: 'custom', build: () => ({ el: cv.btn, get: () => st.cultivarId }) },
  };
}
