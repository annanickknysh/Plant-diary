// Каталог: виды → сорта → растения; места → клумбы → растения; карточки.
import { h, icon, photoImg, formSheet, toast, confirmAction } from '../ui/dom.js';
import {
  catalog, photosByStatus, photosOfPlant, photosOfPlace, plantName, varietyName, placePath, parentPath, placeDepth,
  createSpecies, createCultivar, createPlace, createPlant, updateEntity, deleteEntity, deleteBlocker, speciesName,
  plantsOfTarget, comparableVariety,
} from '../data/store.js';
import { monthGroupedGrid } from '../ui/photoGrid.js';
import { placeField } from '../ui/placePicker.js';
import { formatNumber, plural, PHOTO_FORMS, PLANT_FORMS, formatDate } from '../lib/format.js';
import { rerender } from '../app.js';

const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').trim();
const byName = (a, b) => a.name.localeCompare(b.name, 'ru');
const ui = { query: '' };

const STATUS = { growing: 'растёт', moved: 'пересажено', dead: 'погибло' };

/** Счётчики и обложки по растениям и местам (одним проходом по размеченным фото). */
async function stats() {
  const tagged = await photosByStatus('tagged');
  const plants = new Map();
  const places = new Map();
  const bump = (map, id, p) => {
    const s = map.get(id) || { count: 0, cover: null };
    s.count++;
    if (!s.cover || p.takenAt > s.cover.takenAt) s.cover = p;
    map.set(id, s);
  };
  for (const p of tagged) {
    p.plantIds.forEach((id) => bump(plants, id, p));
    p.placeIds.forEach((id) => bump(places, id, p));
  }
  return { plants, places };
}

function thumbBox(photo) {
  return h('div', { class: 'list-thumb' }, photo ? photoImg(photo.id) : icon('leaf', 22));
}

function listRow(href, photo, title, sub, extraClass = '') {
  return h('a', { class: `list-row ${extraClass}`, href }, thumbBox(photo),
    h('span', { class: 'list-text' }, h('span', { class: 'list-title' }, title), sub ? h('span', { class: 'list-sub' }, sub) : null),
    icon('chevron', 18));
}

const countText = (plants, photos) => {
  const parts = [];
  if (plants !== null) parts.push(`${formatNumber(plants)} ${plural(plants, PLANT_FORMS)}`);
  parts.push(`${formatNumber(photos)} ${plural(photos, PHOTO_FORMS)}`);
  return parts.join(' · ');
};

// ================= список =================

export async function catalogView(tab = 'plants') {
  const s = await stats();
  const page = h('div', { class: 'page' });
  page.append(h('header', { class: 'page-head' }, h('h1', null, 'Каталог')));
  page.append(h('div', { class: 'segmented wide', role: 'group', 'aria-label': 'Раздел каталога' },
    h('a', { href: '#/catalog/plants', 'aria-current': tab === 'plants' ? 'page' : null, class: tab === 'plants' ? 'on' : '' }, 'Растения'),
    h('a', { href: '#/catalog/places', 'aria-current': tab === 'places' ? 'page' : null, class: tab === 'places' ? 'on' : '' }, 'Места')));

  const search = h('input', { type: 'search', placeholder: 'Поиск по виду, сорту, месту', 'aria-label': 'Поиск', autocomplete: 'off' });
  search.value = ui.query;
  const results = h('div', { class: 'list' });
  page.append(h('label', { class: 'search' }, icon('search', 18), search), results);

  const draw = () => {
    results.replaceChildren();
    const q = norm(ui.query);
    if (q) {
      drawSearch(results, q, s);
      return;
    }
    if (tab === 'places') drawPlaces(results, s);
    else drawSpecies(results, s);
  };
  search.addEventListener('input', () => { ui.query = search.value; draw(); });
  draw();

  page.append(h('div', { class: 'add-row' },
    tab === 'places'
      ? h('button', { class: 'btn', type: 'button', onClick: () => placeForm({}) }, icon('plus', 20), 'Новое место')
      : h('button', { class: 'btn', type: 'button', onClick: () => speciesForm({}) }, icon('plus', 20), 'Новый вид')));
  return page;
}

function drawSpecies(el, s) {
  const species = [...catalog.species.values()].sort(byName);
  if (!species.length) {
    el.append(h('p', { class: 'muted empty-note' }, 'Видов пока нет. Они появятся, когда вы отметите первое растение при разборе фото, или добавьте вид вручную.'));
    return;
  }
  const plants = [...catalog.plants.values()];
  for (const sp of species) {
    const own = plants.filter((p) => p.speciesId === sp.id);
    let photos = 0;
    let cover = null;
    for (const p of own) {
      const st = s.plants.get(p.id);
      if (!st) continue;
      photos += st.count;
      if (!cover || st.cover.takenAt > cover.takenAt) cover = st.cover;
    }
    el.append(listRow(`#/species/${sp.id}`, cover, sp.name, [sp.latin, countText(own.length, photos)].filter(Boolean).join(' · ')));
  }
}

function drawPlaces(el, s) {
  const places = [...catalog.places.values()];
  if (!places.length) {
    el.append(h('p', { class: 'muted empty-note' }, 'Мест пока нет. Создайте участок, зону или клумбу — например, «Перед домом» → «Клумба у крыльца».'));
    return;
  }
  const plants = [...catalog.plants.values()];
  const walk = (parentId, depth) => {
    for (const p of places.filter((x) => (x.parentId || null) === parentId).sort(byName)) {
      const n = plants.filter((x) => x.placeId === p.id).length;
      const st = s.places.get(p.id);
      const row = listRow(`#/place/${p.id}`, st?.cover, p.name, p.kind === 'view' ? `вид · ${countText(null, st?.count || 0)}` : countText(n, st?.count || 0));
      row.style.paddingLeft = `${12 + depth * 20}px`;
      el.append(row);
      if (depth < 4) walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
}

function drawSearch(el, q, s) {
  const plants = [...catalog.plants.values()].filter((p) => norm(`${plantName(p)} ${catalog.species.get(p.speciesId)?.latin || ''}`).includes(q));
  const places = [...catalog.places.values()].filter((p) => norm(placePath(p.id)).includes(q));
  if (!plants.length && !places.length) {
    el.append(h('p', { class: 'muted empty-note' }, 'Ничего не нашлось.'));
    return;
  }
  if (plants.length) el.append(h('h3', { class: 'eyebrow' }, 'Растения'));
  for (const p of plants) {
    const st = s.plants.get(p.id);
    el.append(listRow(`#/plant/${p.id}`, st?.cover, varietyName(p), `${placePath(p.placeId)} · ${countText(null, st?.count || 0)}`));
  }
  if (places.length) el.append(h('h3', { class: 'eyebrow' }, 'Места'));
  for (const p of places) {
    const st = s.places.get(p.id);
    el.append(listRow(`#/place/${p.id}`, st?.cover, p.name, placePath(p.id)));
  }
}

// ================= вид =================

export async function speciesView(id) {
  const sp = catalog.species.get(id);
  const page = h('div', { class: 'page' });
  page.append(h('a', { class: 'back-link', href: '#/catalog/plants' }, icon('back', 20), 'Каталог'));
  if (!sp) return notFound(page);
  const s = await stats();
  page.append(h('header', { class: 'page-head tight' }, h('h1', null, sp.name),
    h('p', { class: 'muted' }, [sp.latin && h('i', null, sp.latin), sp.family].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x])))),
  entityActions('species', sp, () => speciesForm(sp), '#/catalog/plants'));
  if (sp.notes) page.append(h('p', { class: 'notes' }, sp.notes));
  page.append(viewLinks('species', id, plantsOfTarget('species', id).length > 1 ? { kind: 'species', id } : null));

  const cultivars = [...catalog.cultivars.values()].filter((c) => c.speciesId === id).sort(byName);
  const plants = [...catalog.plants.values()].filter((p) => p.speciesId === id);
  page.append(h('h2', { class: 'section-title' }, 'Сорта'));
  const chips = h('div', { class: 'chips' });
  for (const c of cultivars) {
    const n = plants.filter((p) => p.cultivarId === c.id).length;
    chips.append(h('span', { class: 'chip big split' },
      h('a', { href: `#/grid/cultivar/${c.id}`, title: 'Сетка сезонов сорта' }, `${c.name} · ${n}`),
      h('button', { class: 'chip-edit', type: 'button', 'aria-label': `Изменить сорт ${c.name}`, onClick: () => cultivarForm(sp, c) }, icon('edit', 15))));
  }
  chips.append(h('button', { class: 'chip big dashed', type: 'button', onClick: () => cultivarForm(sp, null) }, '+ сорт'));
  page.append(chips);

  page.append(h('h2', { class: 'section-title' }, 'Растения'));
  const list = h('div', { class: 'list' });
  for (const p of plants.sort((a, b) => plantName(a).localeCompare(plantName(b), 'ru'))) {
    const st = s.plants.get(p.id);
    list.append(listRow(`#/plant/${p.id}`, st?.cover, varietyName(p), `${placePath(p.placeId)} · ${countText(null, st?.count || 0)}${p.status !== 'growing' ? ` · ${STATUS[p.status]}` : ''}`));
  }
  if (!plants.length) list.append(h('p', { class: 'muted empty-note' }, 'Растений этого вида пока нет.'));
  page.append(list, h('div', { class: 'add-row' }, h('button', { class: 'btn', type: 'button', onClick: () => plantForm({ speciesId: id }) }, icon('plus', 20), 'Добавить растение')));
  return page;
}

// ================= место =================

export async function placeView(id) {
  const place = catalog.places.get(id);
  const page = h('div', { class: 'page' });
  page.append(h('a', { class: 'back-link', href: place?.parentId ? `#/place/${place.parentId}` : '#/catalog/places' }, icon('back', 20), place?.parentId ? catalog.places.get(place.parentId)?.name || 'Назад' : 'Места'));
  if (!place) return notFound(page);
  const [s, photos] = await Promise.all([stats(), photosOfPlace(id)]);
  page.append(h('header', { class: 'page-head tight' }, h('h1', null, place.name),
    h('p', { class: 'muted' }, [place.kind === 'view' ? 'вид' : null, parentPath(id), typeof place.lat === 'number' ? 'есть точка GPS' : null].filter(Boolean).join(' · '))),
  entityActions('places', place, () => placeForm(place), place.parentId ? `#/place/${place.parentId}` : '#/catalog/places'));
  if (place.notes) page.append(h('p', { class: 'notes' }, place.notes));
  page.append(viewLinks('place', id, null));
  const isViewPlace = place.kind === 'view';
  if (!isViewPlace) {
    const withoutPlants = photos.filter((p) => !p.plantIds.length && p.status !== 'hidden').length;
    page.append(h('a', { class: 'btn block', href: `#/tagplace/${id}` }, icon('leaf', 20),
      withoutPlants ? `Отметить растения на фото · ${formatNumber(withoutPlants)} без растений` : 'Отметить растения на фото'));
  }

  const children = [...catalog.places.values()].filter((p) => p.parentId === id).sort(byName);
  if (children.length) {
    page.append(h('h2', { class: 'section-title' }, 'Внутри'));
    const list = h('div', { class: 'list' });
    for (const c of children) list.append(listRow(`#/place/${c.id}`, s.places.get(c.id)?.cover, c.name, `${c.kind === 'view' ? 'вид · ' : ''}${countText(null, s.places.get(c.id)?.count || 0)}`));
    page.append(list);
  }
  if (!isViewPlace) {
    const plants = [...catalog.plants.values()].filter((p) => p.placeId === id).sort((a, b) => varietyName(a).localeCompare(varietyName(b), 'ru'));
    page.append(h('h2', { class: 'section-title' }, 'Растения'));
    const plist = h('div', { class: 'list' });
    for (const p of plants) {
      const st = s.plants.get(p.id);
      plist.append(listRow(`#/plant/${p.id}`, st?.cover, varietyName(p), `${countText(null, st?.count || 0)}${p.status !== 'growing' ? ` · ${STATUS[p.status]}` : ''}`));
    }
    if (!plants.length) plist.append(h('p', { class: 'muted empty-note' }, 'Здесь пока нет растений.'));
    page.append(plist, h('div', { class: 'add-row' },
      h('button', { class: 'btn', type: 'button', onClick: () => plantForm({ placeId: id }) }, icon('plus', 20), 'Растение'),
      placeDepth(id) < 2 ? h('button', { class: 'btn', type: 'button', onClick: () => placeForm({ parentId: id }) }, icon('plus', 20), 'Место внутри') : null));
  }

  page.append(h('h2', { class: 'section-title' }, `Фото · ${formatNumber(photos.length)}`), monthGroupedGrid(photos, { emptyText: 'Фото этого места пока нет.' }));
  return page;
}

// ================= растение =================

export async function plantView(id) {
  const plant = catalog.plants.get(id);
  const page = h('div', { class: 'page' });
  page.append(h('a', { class: 'back-link', href: plant ? `#/species/${plant.speciesId}` : '#/catalog' }, icon('back', 20), plant ? speciesName(plant.speciesId) : 'Каталог'));
  if (!plant) return notFound(page);
  const photos = await photosOfPlant(id);
  const meta = [h('a', { href: `#/place/${plant.placeId}` }, placePath(plant.placeId)), STATUS[plant.status]];
  if (plant.plantedAt) meta.push(`посажено ${plant.plantedAt}`);
  page.append(h('header', { class: 'page-head tight' }, h('h1', null, varietyName(plant)),
    h('p', { class: 'muted' }, meta.flatMap((x, i) => (i ? [' · ', x] : [x])))),
  entityActions('plants', plant, () => plantForm(plant), `#/species/${plant.speciesId}`));
  if (plant.notes) page.append(h('p', { class: 'notes' }, plant.notes));
  if (photos.length) {
    const first = Math.min(...photos.map((p) => p.takenAt));
    const last = Math.max(...photos.map((p) => p.takenAt));
    page.append(h('p', { class: 'muted' }, `${formatNumber(photos.length)} ${plural(photos.length, PHOTO_FORMS)} · с ${formatDate(first)} по ${formatDate(last)}`));
  }
  page.append(viewLinks('plant', id, comparableVariety(plant)));
  const years = [...new Set(photos.map((p) => new Date(p.takenAt).getFullYear()))].sort((a, b) => b - a);
  let year = plantYear.get(id) ?? null;
  if (year !== null && !years.includes(year)) year = null;
  if (years.length > 1) {
    page.append(h('div', { class: 'chips-row' },
      h('button', { class: 'pill', type: 'button', 'aria-pressed': String(year === null), onClick: () => { plantYear.delete(id); rerender(); } }, 'Все годы'),
      years.map((y) => h('button', { class: 'pill', type: 'button', 'aria-pressed': String(year === y), onClick: () => { plantYear.set(id, y); rerender(); } }, String(y)))));
  }
  const shown = year === null ? photos : photos.filter((p) => new Date(p.takenAt).getFullYear() === year);
  page.append(monthGroupedGrid(shown, { emptyText: 'Фото этого растения пока нет. Отметьте их на экране «Разбор».' }));
  return page;
}

// ================= общие части =================

const plantYear = new Map();

/** Ссылки на сетку сезонов и сравнение клумб. */
function viewLinks(kind, id, variety) {
  return h('div', { class: 'view-links' },
    h('a', { class: 'btn primary', href: `#/grid/${kind}/${id}` }, icon('grid', 20), 'Сетка сезонов'),
    variety ? h('a', { class: 'btn', href: `#/compare/${variety.kind}/${variety.id}` }, 'Сравнить клумбы') : null);
}

function notFound(page) {
  page.append(h('section', { class: 'empty' }, h('h2', null, 'Не найдено'), h('p', null, 'Возможно, запись была удалена.')));
  return page;
}

function entityActions(kind, obj, onEdit, afterDeleteHref) {
  return h('div', { class: 'entity-actions' },
    h('button', { class: 'pill', type: 'button', onClick: onEdit }, icon('edit', 16), 'Изменить'),
    h('button', {
      class: 'pill', type: 'button',
      onClick: async () => {
        const blocker = deleteBlocker(kind, obj.id);
        if (blocker) { toast(blocker, { duration: 6000 }); return; }
        const what = { species: 'этот вид', places: 'это место', plants: 'это растение' }[kind];
        if (!confirmAction(`Удалить ${what}? Фото не удаляются: те, у которых не останется отметок, вернутся в «Разбор».`)) return;
        await deleteEntity(kind, obj.id);
        toast('Удалено');
        location.hash = afterDeleteHref;
      },
    }, icon('trash', 16), 'Удалить'));
}

function speciesForm(sp) {
  formSheet({
    title: sp.id ? 'Вид' : 'Новый вид',
    fields: [
      { name: 'name', label: 'Название', value: sp.name, required: true, placeholder: 'Например, Хоста' },
      { name: 'latin', label: 'Латинское название', value: sp.latin, placeholder: 'Hosta' },
      { name: 'family', label: 'Семейство', value: sp.family, placeholder: 'Спаржевые' },
      { name: 'notes', label: 'Заметки', type: 'textarea', value: sp.notes },
    ],
    onSubmit: async (v) => {
      if (!v.name.trim()) throw new Error('Введите название.');
      if (sp.id) await updateEntity('species', { ...sp, ...v, name: v.name.trim() });
      else {
        const created = await createSpecies(v);
        location.hash = `#/species/${created.id}`;
        return;
      }
      rerender();
    },
  });
}

function cultivarForm(sp, cv) {
  formSheet({
    title: cv ? `Сорт · ${sp.name}` : `Новый сорт · ${sp.name}`,
    fields: [
      { name: 'name', label: 'Название сорта', value: cv?.name, required: true, placeholder: 'Например, June' },
      { name: 'notes', label: 'Заметки', type: 'textarea', value: cv?.notes },
    ],
    onSubmit: async (v) => {
      if (!v.name.trim()) throw new Error('Введите название.');
      if (cv) await updateEntity('cultivars', { ...cv, ...v, name: v.name.trim() });
      else await createCultivar({ speciesId: sp.id, ...v });
      rerender();
    },
  });
}

function placeForm(place) {
  formSheet({
    title: place.id ? 'Место' : 'Новое место',
    fields: [
      { name: 'name', label: 'Название', value: place.name, required: true, placeholder: 'Например, Клумба у крыльца' },
      { name: 'kind', label: 'Что это', type: 'select', value: place.kind || 'bed', options: [{ value: 'bed', label: 'Клумба, зона или другое место' }, { value: 'view', label: 'Вид (ракурс, который снимаю из года в год)' }] },
      { name: 'parentId', label: 'Входит в', type: 'custom', build: () => placeField({ value: place.parentId || null, title: 'Входит в', excludeId: place.id || null, allowNone: true }) },
      { name: 'notes', label: 'Описание', type: 'textarea', value: place.notes, placeholder: 'Солнце до обеда, почва…' },
    ],
    onSubmit: async (v) => {
      if (!v.name.trim()) throw new Error('Введите название.');
      const data = { name: v.name.trim(), parentId: v.parentId || null, notes: v.notes, kind: v.kind };
      if (v.kind === 'view' && place.id) {
        if ([...catalog.plants.values()].some((p) => p.placeId === place.id)) throw new Error('Здесь растут растения — вид не может содержать растения. Сначала перенесите их.');
        if ([...catalog.places.values()].some((p) => p.parentId === place.id)) throw new Error('Внутри есть другие места — вид не может их содержать.');
      }
      if (place.id) await updateEntity('places', { ...place, ...data });
      else {
        const created = await createPlace(data);
        location.hash = `#/place/${created.id}`;
        return;
      }
      rerender();
    },
  });
}

function plantForm(plant) {
  const species = [...catalog.species.values()].sort(byName);
  if (!species.length) { toast('Сначала добавьте вид'); return; }
  if (!catalog.places.size) { toast('Сначала добавьте место'); return; }
  const speciesId = plant.speciesId || species[0].id;
  const cultivars = [...catalog.cultivars.values()].filter((c) => c.speciesId === speciesId).sort(byName);
  formSheet({
    title: plant.id ? 'Растение' : 'Новое растение',
    fields: [
      { name: 'speciesId', label: 'Вид', type: 'select', value: speciesId, options: species.map((s) => ({ value: s.id, label: s.name })) },
      { name: 'cultivarId', label: 'Сорт', type: 'select', value: plant.cultivarId || '', options: [{ value: '', label: 'Без сорта' }, ...cultivars.map((c) => ({ value: c.id, label: c.name }))] },
      { name: 'placeId', label: 'Где растёт', type: 'custom', build: () => placeField({ value: plant.placeId || null, title: 'Где растёт' }) },
      { name: 'plantedAt', label: 'Когда посажено (год или дата)', value: plant.plantedAt || '', placeholder: '2021' },
      { name: 'status', label: 'Состояние', type: 'select', value: plant.status || 'growing', options: Object.entries(STATUS).map(([value, label]) => ({ value, label })) },
      { name: 'notes', label: 'Заметки', type: 'textarea', value: plant.notes },
    ],
    onSubmit: async (v) => {
      if (!v.placeId) throw new Error('Выберите, где растёт растение.');
      const cultivarOk = !v.cultivarId || catalog.cultivars.get(v.cultivarId)?.speciesId === v.speciesId;
      const data = { speciesId: v.speciesId, cultivarId: cultivarOk ? v.cultivarId || null : null, placeId: v.placeId, plantedAt: v.plantedAt.trim() || null, status: v.status, notes: v.notes };
      if (plant.id) await updateEntity('plants', { ...plant, ...data });
      else {
        const created = await createPlant(data);
        await updateEntity('plants', { ...created, status: data.status });
        location.hash = `#/plant/${created.id}`;
        return;
      }
      rerender();
    },
  });
}
