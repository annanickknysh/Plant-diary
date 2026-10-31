// Нижняя панель «Отметить фото»: клумба (одна) или растения (несколько).
import { h, icon, clear, openSheet } from '../ui/dom.js';
import {
  catalog, plantName, placePath, parentPath, getSetting, createSpecies, createCultivar, createPlant, varietyName,
} from '../data/store.js';
import { centerOf, distanceMeters } from '../lib/geo.js';
import { formatNumber, plural, PHOTO_FORMS } from '../lib/format.js';
import { placeBrowser, placeField } from '../ui/placePicker.js';

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
  const st = { mode: initialMode, query: '', picked: new Set(), creating: false, browser: {} };

  openSheet((close) => {
    const root = h('div', { class: 'tag-sheet' });

    const draw = () => {
      clear(root);
      root.append(h('div', { class: 'sheet-header' },
        h('h2', { class: 'sheet-title' }, `Отметить ${formatNumber(n)} ${plural(n, PHOTO_FORMS)}`),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onClick: close }, icon('close'))));

      const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Что отмечаем' },
        h('button', { type: 'button', 'aria-pressed': String(st.mode === 'place'), onClick: () => switchMode('place') }, 'Клумба или вид'),
        h('button', { type: 'button', 'aria-pressed': String(st.mode === 'plant'), onClick: () => switchMode('plant') }, 'Растение'));
      root.append(seg);

      if (st.mode === 'place') {
        root.append(...placeNear(), placeBrowser({
          isSelected: (id) => st.picked.has(id), onSelect: toggle, recentIds: recentPlaces, gpsCenter: center, state: st.browser,
        }));
      } else if (st.creating) {
        root.append(plantForm());
        return;
      } else {

      const search = h('input', {
        type: 'search', placeholder: st.mode === 'place' ? 'Найти клумбу или место' : 'Найти растение, сорт, вид',
        'aria-label': 'Поиск', autocomplete: 'off',
      });
      search.value = st.query;
      search.addEventListener('input', () => { st.query = search.value; drawLists(); });
      const lists = h('div', { class: 'tag-lists' });
      root.append(h('label', { class: 'search' }, icon('search', 18), search), lists);
      const drawLists = () => {
        clear(lists);
        lists.append(...plantSections().filter(Boolean));
        lists.append(h('button', { class: 'btn dashed block', type: 'button', onClick: () => { st.creating = true; draw(); } },
          icon('plus', 20), 'Создать новое растение'));
      };
      drawLists();
      }

      const count = st.picked.size;
      root.append(h('div', { class: 'sheet-footer' },
        h('button', {
          class: 'btn primary block', type: 'button', disabled: count === 0,
          onClick: async () => {
            const ids = [...st.picked];
            close();
            await onApply(st.mode === 'place' ? { placeId: ids[0], plantIds: [] } : { placeId: null, plantIds: ids });
          },
        }, count === 0 ? (st.mode === 'place' ? 'Выберите клумбу или вид' : 'Выберите растения') : `Отметить ${formatNumber(n)} ${plural(n, PHOTO_FORMS)}`)));
    };

    const switchMode = (m) => {
      if (st.mode === m) return;
      st.mode = m;
      st.picked.clear();
      st.query = '';
      st.creating = false;
      st.browser = {};
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

    const placeNear = () => {
      if (!center) return [];
      const near = [...catalog.places.values()].filter((p) => typeof p.lat === 'number')
        .map((p) => ({ p, d: distanceMeters(center, p) }))
        .filter((x) => x.d <= 150).sort((a, b) => a.d - b.d).slice(0, 3);
      const rows = near.map((x) => row(x.p.id, x.p.name, [parentPath(x.p.id), `≈ ${Math.max(1, Math.round(x.d))} м от места съёмки`].filter(Boolean).join(' · ')));
      return rows.length ? [section('Рядом по GPS', rows)] : [];
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
      let placeId = defaultPlace || null;
      const place = placeField({ value: placeId, title: 'Где растёт', onChange: (id) => { placeId = id; } });
      const err = h('p', { class: 'form-error', role: 'alert' });
      const form = h('form', { class: 'form' }, dlSpecies, dlCult,
        h('label', { class: 'field' }, h('span', null, 'Вид'), species),
        h('label', { class: 'field' }, h('span', null, 'Сорт'), cultivar),
        h('div', { class: 'field' }, h('span', null, 'Где растёт'), place.el),
        
        err,
        h('div', { class: 'row-buttons' },
          h('button', { class: 'btn', type: 'button', onClick: () => { st.creating = false; draw(); } }, 'Назад'),
          h('button', { class: 'btn primary', type: 'submit' }, 'Создать и выбрать')));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!species.value.trim()) { err.textContent = 'Укажите вид.'; return; }
        if (!placeId) { err.textContent = 'Выберите, где растёт растение.'; return; }
        const sp = findSpecies() || await createSpecies({ name: species.value });
        let cv = null;
        if (cultivar.value.trim()) {
          cv = [...catalog.cultivars.values()].find((c) => c.speciesId === sp.id && norm(c.name) === norm(cultivar.value))
            || await createCultivar({ speciesId: sp.id, name: cultivar.value });
        }
        const existing = [...catalog.plants.values()].find((p) => p.speciesId === sp.id && (p.cultivarId || null) === (cv?.id || null) && p.placeId === placeId);
        const plant = existing || await createPlant({ speciesId: sp.id, cultivarId: cv?.id || null, placeId });
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
