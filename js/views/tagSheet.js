// Нижняя панель «Отметить фото»: клумба (одна) или растения (несколько).
import { h, icon, clear, openSheet } from '../ui/dom.js';
import {
  catalog, plantName, placePath, parentPath, getSetting, createPlace, createSpecies, createCultivar, createPlant, varietyName,
} from '../data/store.js';
import { centerOf, distanceMeters } from '../lib/geo.js';
import { formatNumber, plural, PHOTO_FORMS } from '../lib/format.js';

const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').trim();

/**
 * @param {{photos: Array, mode: 'place'|'plant', onApply: ({placeId, plantIds}) => Promise}} opts
 */
export async function openTagSheet({ photos, mode: initialMode = 'place', onApply }) {
  const recentPlaces = (await getSetting('recentPlaces')).filter((id) => catalog.places.has(id));
  const recentPlants = (await getSetting('recentPlants')).filter((id) => catalog.plants.has(id));
  const center = centerOf(photos);
  const photoPlaceIds = [...new Set(photos.flatMap((p) => p.placeIds))];
  const n = photos.length;
  const st = { mode: initialMode, query: '', picked: new Set(), creating: false };

  openSheet((close) => {
    const root = h('div', { class: 'tag-sheet' });

    const draw = () => {
      clear(root);
      root.append(h('div', { class: 'sheet-header' },
        h('h2', { class: 'sheet-title' }, `Отметить ${formatNumber(n)} ${plural(n, PHOTO_FORMS)}`),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onClick: close }, icon('close'))));

      const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Что отмечаем' },
        h('button', { type: 'button', 'aria-pressed': String(st.mode === 'place'), onClick: () => switchMode('place') }, 'Клумба'),
        h('button', { type: 'button', 'aria-pressed': String(st.mode === 'plant'), onClick: () => switchMode('plant') }, 'Растение'));
      root.append(seg);

      if (st.creating) {
        root.append(st.mode === 'place' ? placeForm() : plantForm());
        return;
      }

      const search = h('input', {
        type: 'search', placeholder: st.mode === 'place' ? 'Найти клумбу или место' : 'Найти растение, сорт, вид',
        'aria-label': 'Поиск', autocomplete: 'off',
      });
      search.value = st.query;
      search.addEventListener('input', () => { st.query = search.value; drawLists(); });
      root.append(h('label', { class: 'search' }, icon('search', 18), search));

      const lists = h('div', { class: 'tag-lists' });
      root.append(lists);
      const drawLists = () => {
        clear(lists);
        lists.append(...(st.mode === 'place' ? placeSections() : plantSections()).filter(Boolean));
        lists.append(h('button', { class: 'btn dashed block', type: 'button', onClick: () => { st.creating = true; draw(); } },
          icon('plus', 20), st.mode === 'place' ? 'Создать новую клумбу' : 'Создать новое растение'));
      };
      drawLists();

      const count = st.picked.size;
      root.append(h('div', { class: 'sheet-footer' },
        h('button', {
          class: 'btn primary block', type: 'button', disabled: count === 0,
          onClick: async () => {
            const ids = [...st.picked];
            close();
            await onApply(st.mode === 'place' ? { placeId: ids[0], plantIds: [] } : { placeId: null, plantIds: ids });
          },
        }, count === 0 ? (st.mode === 'place' ? 'Выберите клумбу' : 'Выберите растения') : `Отметить ${formatNumber(n)} ${plural(n, PHOTO_FORMS)}`)));
    };

    const switchMode = (m) => {
      if (st.mode === m) return;
      st.mode = m;
      st.picked.clear();
      st.query = '';
      st.creating = false;
      draw();
    };

    const toggle = (id) => {
      if (st.mode === 'place') {
        const had = st.picked.has(id);
        st.picked.clear();
        if (!had) st.picked.add(id);
      } else if (st.picked.has(id)) st.picked.delete(id);
      else st.picked.add(id);
      draw();
    };

    const row = (id, title, sub) => {
      const on = st.picked.has(id);
      return h('button', { class: `pick-row${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), onClick: () => toggle(id) },
        h('span', { class: 'pick-text' }, h('span', { class: 'pick-title' }, title), sub ? h('span', { class: 'pick-sub' }, sub) : null),
        on ? icon('check', 22) : null);
    };

    const section = (title, rows) => (rows.length ? h('div', { class: 'pick-section' }, h('h3', { class: 'eyebrow' }, title), rows) : null);

    const placeSections = () => {
      const places = [...catalog.places.values()];
      const out = [];
      const q = norm(st.query);
      if (q) {
        const found = places.filter((p) => norm(placePath(p.id)).includes(q)).sort((a, b) => placePath(a.id).localeCompare(placePath(b.id), 'ru'));
        out.push(section('Найдено', found.map((p) => row(p.id, p.name, parentPath(p.id)))));
        if (!found.length) out.push(h('p', { class: 'muted' }, 'Ничего не нашлось. Создайте новую клумбу.'));
        return out;
      }
      const shown = new Set();
      if (center) {
        const near = places.filter((p) => typeof p.lat === 'number')
          .map((p) => ({ p, d: distanceMeters(center, p) }))
          .filter((x) => x.d <= 150).sort((a, b) => a.d - b.d).slice(0, 3);
        near.forEach((x) => shown.add(x.p.id));
        out.push(section('Рядом по GPS', near.map((x) => row(x.p.id, x.p.name, [parentPath(x.p.id), `≈ ${Math.max(1, Math.round(x.d))} м от места съёмки`].filter(Boolean).join(' · ')))));
      }
      const rec = recentPlaces.filter((id) => !shown.has(id));
      rec.forEach((id) => shown.add(id));
      out.push(section('Недавние', rec.map((id) => row(id, catalog.places.get(id).name, parentPath(id)))));
      const rest = places.filter((p) => !shown.has(p.id)).sort((a, b) => placePath(a.id).localeCompare(placePath(b.id), 'ru'));
      out.push(section('Все места', rest.map((p) => row(p.id, p.name, parentPath(p.id)))));
      if (!places.length) out.push(h('p', { class: 'muted' }, 'Мест пока нет. Создайте первую клумбу — дальше она будет в списке.'));
      return out;
    };

    const plantSections = () => {
      const plants = [...catalog.plants.values()];
      const out = [];
      const q = norm(st.query);
      const label = (p) => row(p.id, varietyName(p), placePath(p.placeId));
      if (q) {
        const found = plants.filter((p) => norm(`${plantName(p)} ${catalog.species.get(p.speciesId)?.latin || ''}`).includes(q));
        out.push(section('Найдено', found.map(label)));
        if (!found.length) out.push(h('p', { class: 'muted' }, 'Ничего не нашлось. Создайте новое растение.'));
        return out;
      }
      const shown = new Set();
      if (photoPlaceIds.length) {
        const here = plants.filter((p) => photoPlaceIds.includes(p.placeId) && p.status !== 'dead');
        here.forEach((p) => shown.add(p.id));
        out.push(section('Растут в отмеченной клумбе', here.map(label)));
      }
      const rec = recentPlants.filter((id) => !shown.has(id));
      rec.forEach((id) => shown.add(id));
      out.push(section('Недавние', rec.map((id) => label(catalog.plants.get(id)))));
      const rest = plants.filter((p) => !shown.has(p.id)).sort((a, b) => plantName(a).localeCompare(plantName(b), 'ru'));
      out.push(section('Все растения', rest.map(label)));
      if (!plants.length) out.push(h('p', { class: 'muted' }, 'Растений пока нет. Создайте первое: вид, сорт и клумбу, где оно растёт.'));
      return out;
    };

    // ---------- создание клумбы ----------
    const placeForm = () => {
      const name = h('input', { type: 'text', required: true, autocomplete: 'off', placeholder: 'Например, Клумба у крыльца' });
      const parent = h('select', null, h('option', { value: '' }, 'Без родителя (верхний уровень)'),
        [...catalog.places.values()].sort((a, b) => placePath(a.id).localeCompare(placePath(b.id), 'ru'))
          .map((p) => h('option', { value: p.id }, placePath(p.id))));
      const gps = center ? h('input', { type: 'checkbox', checked: true }) : null;
      const err = h('p', { class: 'form-error', role: 'alert' });
      const form = h('form', { class: 'form' },
        h('label', { class: 'field' }, h('span', null, 'Название клумбы или места'), name),
        h('label', { class: 'field' }, h('span', null, 'Входит в'), parent),
        gps ? h('label', { class: 'check' }, gps, h('span', null, 'Запомнить место по GPS из этих фото — для подсказок')) : null,
        err,
        h('div', { class: 'row-buttons' },
          h('button', { class: 'btn', type: 'button', onClick: () => { st.creating = false; draw(); } }, 'Назад'),
          h('button', { class: 'btn primary', type: 'submit' }, 'Создать и выбрать')));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!name.value.trim()) { err.textContent = 'Введите название.'; return; }
        const p = await createPlace({
          name: name.value, parentId: parent.value || null,
          lat: gps?.checked ? center.lat : null, lon: gps?.checked ? center.lon : null,
        });
        st.picked.clear();
        st.picked.add(p.id);
        st.creating = false;
        draw();
      });
      setTimeout(() => name.focus(), 30);
      return form;
    };

    // ---------- создание растения ----------
    const plantForm = () => {
      const speciesList = [...catalog.species.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      const dlSpecies = h('datalist', { id: 'dl-species' }, speciesList.map((s) => h('option', { value: s.name })));
      const dlCult = h('datalist', { id: 'dl-cultivars' });
      const species = h('input', { type: 'text', list: 'dl-species', autocomplete: 'off', placeholder: 'Например, Хоста' });
      const cultivar = h('input', { type: 'text', list: 'dl-cultivars', autocomplete: 'off', placeholder: 'Например, June (можно оставить пустым)' });
      const findSpecies = () => speciesList.find((s) => norm(s.name) === norm(species.value));
      species.addEventListener('input', () => {
        const sp = findSpecies();
        clear(dlCult).append(...[...catalog.cultivars.values()].filter((c) => sp && c.speciesId === sp.id).map((c) => h('option', { value: c.name })));
      });
      const defaultPlace = photoPlaceIds[0] || recentPlaces[0] || '';
      const place = h('select', { required: true },
        h('option', { value: '' }, 'Выберите клумбу'),
        [...catalog.places.values()].sort((a, b) => placePath(a.id).localeCompare(placePath(b.id), 'ru'))
          .map((p) => h('option', { value: p.id, selected: p.id === defaultPlace }, placePath(p.id))));
      const err = h('p', { class: 'form-error', role: 'alert' });
      const form = h('form', { class: 'form' }, dlSpecies, dlCult,
        h('label', { class: 'field' }, h('span', null, 'Вид'), species),
        h('label', { class: 'field' }, h('span', null, 'Сорт'), cultivar),
        h('label', { class: 'field' }, h('span', null, 'Где растёт'), place),
        catalog.places.size ? null : h('p', { class: 'muted' }, 'Сначала создайте клумбу на вкладке «Клумба».'),
        err,
        h('div', { class: 'row-buttons' },
          h('button', { class: 'btn', type: 'button', onClick: () => { st.creating = false; draw(); } }, 'Назад'),
          h('button', { class: 'btn primary', type: 'submit' }, 'Создать и выбрать')));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!species.value.trim()) { err.textContent = 'Укажите вид.'; return; }
        if (!place.value) { err.textContent = 'Выберите, где растёт растение.'; return; }
        const sp = findSpecies() || await createSpecies({ name: species.value });
        let cv = null;
        if (cultivar.value.trim()) {
          cv = [...catalog.cultivars.values()].find((c) => c.speciesId === sp.id && norm(c.name) === norm(cultivar.value))
            || await createCultivar({ speciesId: sp.id, name: cultivar.value });
        }
        const existing = [...catalog.plants.values()].find((p) => p.speciesId === sp.id && (p.cultivarId || null) === (cv?.id || null) && p.placeId === place.value);
        const plant = existing || await createPlant({ speciesId: sp.id, cultivarId: cv?.id || null, placeId: place.value });
        st.picked.add(plant.id);
        st.creating = false;
        draw();
      });
      setTimeout(() => species.focus(), 30);
      return form;
    };

    draw();
    return root;
  }, { label: 'Отметить фото', tall: true });
}
