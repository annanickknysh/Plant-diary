// Выбор места деревом: недавние, зоны → клумбы, поиск, создание прямо в выбранной зоне.
import { h, icon, clear, openSheet } from './dom.js';
import { catalog, placePath, parentPath, createPlace, getSetting } from '../data/store.js';

const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').trim();
const byName = (a, b) => a.name.localeCompare(b.name, 'ru');

const childrenOf = (parentId) => [...catalog.places.values()].filter((p) => (p.parentId || null) === parentId).sort(byName);

function plantsIn(id) {
  let n = 0;
  for (const p of catalog.plants.values()) if (p.placeId === id) n++;
  return n;
}

/**
 * Встраиваемый выбор места.
 * @param opts.isSelected(id) — отмечено ли место
 * @param opts.onSelect(id) — выбор места
 * @param opts.startLevel — с какой зоны начать (id родителя) или null
 * @param opts.recentIds — недавние места
 * @param opts.gpsCenter — координаты фото, чтобы предложить запомнить точку новой клумбы
 * @param opts.excludeId — не показывать это место и его вложенные (при выборе родителя)
 * @param opts.noViews — скрыть виды (для растений и выбора родителя)
 */
export function placeBrowser({ isSelected = () => false, onSelect, startLevel = null, recentIds = [], gpsCenter = null, excludeId = null, noViews = false, state = null }) {
  // Состояние можно передать снаружи, чтобы зона и поиск не сбрасывались при перерисовке
  const st = state || {};
  if (!('level' in st)) Object.assign(st, { level: startLevel && catalog.places.has(startLevel) ? startLevel : null, query: '', creating: false });
  if (st.level && !catalog.places.has(st.level)) st.level = null;
  const root = h('div', { class: 'place-browser' });
  const excluded = (id) => (noViews && catalog.places.get(id)?.kind === 'view')
    || (excludeId && (id === excludeId || placePath(id).startsWith(`${placePath(excludeId)} › `)));

  const search = h('input', { type: 'search', placeholder: 'Найти клумбу или зону', 'aria-label': 'Поиск места', autocomplete: 'off' });
  search.value = st.query;
  search.addEventListener('input', () => { st.query = search.value; drawBody(); });
  const body = h('div', { class: 'tag-lists' });
  root.append(h('label', { class: 'search' }, icon('search', 18), search), body);

  const row = (p, sub) => {
    const on = isSelected(p.id);
    const kids = childrenOf(p.id).filter((c) => !excluded(c.id));
    const view = p.kind === 'view';
    const pick = h('button', { class: `pick-row${on ? ' on' : ''}${view ? ' view' : ''}`, type: 'button', 'aria-pressed': String(on), onClick: () => onSelect(p.id) },
      h('span', { class: 'pick-text' }, h('span', { class: 'pick-title' }, view ? icon('eye', 18) : null, p.name),
        h('span', { class: 'pick-sub' }, [view ? 'вид' : null, sub].filter(Boolean).join(' · ') || null)),
      on ? icon('check', 22) : null);
    // Верхний уровень — обычно зоны: их можно открыть, даже если внутри пока пусто
    if (view || (!kids.length && p.parentId)) return pick;
    const n = kids.length;
    return h('div', { class: 'pick-split' }, pick,
      h('button', { class: 'drill', type: 'button', 'aria-label': `Открыть «${p.name}»${n ? `: ${n} внутри` : ''}`, onClick: () => { st.level = p.id; st.query = ''; search.value = ''; drawBody(); } },
        n ? h('span', null, String(n)) : null, icon('chevron', 18)));
  };

  const subFor = (p) => {
    const parts = [];
    const all = childrenOf(p.id);
    const views = all.filter((c) => c.kind === 'view').length;
    const kids = all.length - views;
    const plants = plantsIn(p.id);
    if (kids) parts.push(`мест внутри: ${kids}`);
    if (views) parts.push(`видов: ${views}`);
    if (plants) parts.push(`растений: ${plants}`);
    return parts.join(' · ');
  };

  const drawBody = () => {
    clear(body);
    const q = norm(st.query);
    if (q) {
      const found = [...catalog.places.values()].filter((p) => !excluded(p.id) && norm(placePath(p.id)).includes(q))
        .sort((a, b) => placePath(a.id).localeCompare(placePath(b.id), 'ru')).slice(0, 60);
      body.append(h('h3', { class: 'eyebrow' }, 'Найдено'));
      found.forEach((p) => body.append(row(p, parentPath(p.id))));
      if (!found.length) body.append(h('p', { class: 'muted' }, 'Ничего не нашлось.'));
      body.append(createBlock(st.query.trim()));
      return;
    }
    if (st.level === null) {
      const rec = recentIds.filter((id) => catalog.places.has(id) && !excluded(id));
      if (rec.length) {
        body.append(h('h3', { class: 'eyebrow' }, 'Недавние'));
        rec.forEach((id) => body.append(row(catalog.places.get(id), parentPath(id))));
      }
      body.append(h('h3', { class: 'eyebrow' }, 'Все зоны и места'));
    } else {
      const cur = catalog.places.get(st.level);
      const up = cur.parentId ? catalog.places.get(cur.parentId) : null;
      body.append(h('button', { class: 'crumb', type: 'button', onClick: () => { st.level = cur.parentId || null; drawBody(); } },
        icon('back', 18), up ? up.name : 'Все места'));
      body.append(h('h3', { class: 'eyebrow' }, cur.name));
      const whole = isSelected(cur.id);
      body.append(h('button', { class: `pick-row whole${whole ? ' on' : ''}`, type: 'button', 'aria-pressed': String(whole), onClick: () => onSelect(cur.id) },
        h('span', { class: 'pick-text' }, h('span', { class: 'pick-title' }, `Вся «${cur.name}»`), h('span', { class: 'pick-sub' }, 'выбрать зону целиком')),
        whole ? icon('check', 22) : null));
    }
    const kids = childrenOf(st.level).filter((p) => !excluded(p.id));
    kids.forEach((p) => body.append(row(p, subFor(p))));
    if (!kids.length && st.level === null) body.append(h('p', { class: 'muted' }, 'Мест пока нет. Создайте первую зону или клумбу.'));
    body.append(createBlock(''));
  };

  const createBlock = (prefill) => {
    const parent = st.level ? catalog.places.get(st.level) : null;
    const bedLabel = parent ? `Новая клумба в «${parent.name}»` : 'Новая зона или клумба';
    const viewLabel = parent ? `Новый вид в «${parent.name}»` : 'Новый вид';
    if (!st.creating) {
      const start = (kind) => () => { st.creating = kind; st.prefill = prefill; drawBody(); };
      return h('div', { class: 'create-row' },
        h('button', { class: 'btn dashed', type: 'button', onClick: start('bed') }, icon('plus', 20), bedLabel),
        noViews ? null : h('button', { class: 'btn dashed', type: 'button', onClick: start('view') }, icon('eye', 20), viewLabel));
    }
    const isViewKind = st.creating === 'view';
    const label = isViewKind ? viewLabel : bedLabel;
    const name = h('input', { type: 'text', autocomplete: 'off', placeholder: isViewKind ? 'Например, «Вид на дом» или «Вид дорожки»' : 'Название, например «Клумба у крыльца»' });
    name.value = st.prefill || '';
    const gps = gpsCenter ? h('input', { type: 'checkbox', checked: true }) : null;
    const err = h('p', { class: 'form-error', role: 'alert' });
    const form = h('form', { class: 'form create-inline' },
      h('label', { class: 'field' }, h('span', null, label), name),
      isViewKind ? h('p', { class: 'muted small' }, 'Вид — это ракурс, который вы снимаете из года в год. Растения к нему не привязываются.') : null,
      gps ? h('label', { class: 'check' }, gps, h('span', null, 'Запомнить точку GPS из этих фото — для подсказок')) : null,
      err,
      h('div', { class: 'row-buttons' },
        h('button', { class: 'btn', type: 'button', onClick: () => { st.creating = false; drawBody(); } }, 'Отмена'),
        h('button', { class: 'btn primary', type: 'submit' }, 'Создать и выбрать')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!name.value.trim()) { err.textContent = 'Введите название.'; return; }
      const p = await createPlace({ name: name.value, parentId: st.level, kind: isViewKind ? 'view' : 'bed', lat: gps?.checked ? gpsCenter.lat : null, lon: gps?.checked ? gpsCenter.lon : null });
      st.creating = false;
      st.query = '';
      search.value = '';
      onSelect(p.id);
      drawBody();
    });
    setTimeout(() => name.focus(), 30);
    return form;
  };

  drawBody();
  return root;
}

/** Открыть выбор места в отдельной панели. onPick(id) вызывается после выбора. */
export async function openPlacePicker({ value = null, title = 'Где растёт', onPick, excludeId = null, allowNone = false, noViews = false }) {
  const recentIds = await getSetting('recentPlaces');
  openSheet((close) => {
    const wrap = h('div', { class: 'tag-sheet' },
      h('div', { class: 'sheet-header' }, h('h2', { class: 'sheet-title' }, title),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onClick: close }, icon('close'))));
    if (allowNone) {
      wrap.append(h('button', { class: `pick-row${!value ? ' on' : ''}`, type: 'button', onClick: () => { close(); onPick(null); } },
        h('span', { class: 'pick-text' }, h('span', { class: 'pick-title' }, 'Верхний уровень'), h('span', { class: 'pick-sub' }, 'не входит ни в какую зону'))));
    }
    wrap.append(placeBrowser({
      isSelected: (id) => id === value,
      onSelect: (id) => { close(); onPick(id); },
      startLevel: value ? catalog.places.get(value)?.parentId || null : null,
      recentIds,
      excludeId,
      noViews,
    }));
    return wrap;
  }, { label: title, tall: true });
}

/** Поле формы «место»: кнопка с выбранным путём, открывает дерево. */
export function placeField({ value = null, placeholder = 'Выберите клумбу', title, excludeId = null, allowNone = false, noViews = true, onChange }) {
  let cur = value;
  const text = h('span', { class: 'place-field-text' });
  const btn = h('button', { class: 'place-field', type: 'button' }, text, icon('chevron', 18));
  const draw = () => {
    text.textContent = cur ? placePath(cur) : (allowNone ? 'Верхний уровень' : placeholder);
    btn.classList.toggle('empty', !cur && !allowNone);
  };
  btn.addEventListener('click', () => openPlacePicker({
    value: cur, title, excludeId, allowNone, noViews,
    onPick: (id) => { cur = id; draw(); onChange?.(id); },
  }));
  draw();
  return { el: btn, get: () => cur };
}
