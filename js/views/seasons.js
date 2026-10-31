// Сезоны: выбор растения или места, сетка «годы × сезоны / месяцы», сравнение клумб.
import { h, icon, photoImg, toast, clear } from '../ui/dom.js';
import {
  catalog, photosForTarget, plantsOfTarget, targetName, targetSubtitle, targetExists, comparableVariety,
  getPins, setPin, rememberTarget, recentTargets, varietyName, placePath, photosByStatus,
} from '../data/store.js';
import { buildGrid, buildComparison } from '../lib/periods.js';
import { seasonOf } from '../lib/seasons.js';
import { formatNumber, plural, PHOTO_FORMS, PLANT_FORMS } from '../lib/format.js';
import { openViewer } from './viewer.js';
import { openCompare } from './comparePhotos.js';
import { rerender } from '../app.js';

const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').trim();
const SEASON_CHIPS = [['spring', 'Весна'], ['summer', 'Лето'], ['autumn', 'Осень'], ['winter', 'Зима']];

// Состояние экранов по объекту: режим, фильтр лет, столбец, выбор для сравнения
const gridState = new Map();
const homeUi = { query: '', tab: 'places', open: new Set() };

// ======================= выбор объекта =======================

export async function seasonsHome() {
  const [tagged, recent] = await Promise.all([photosByStatus('tagged'), recentTargets()]);
  // Счётчики фото: по растению, сорту, виду и по месту вместе со всем, что внутри него
  const count = { plant: new Map(), cultivar: new Map(), species: new Map(), place: new Map() };
  const cover = new Map();
  const bump = (kind, id, p) => {
    count[kind].set(id, (count[kind].get(id) || 0) + 1);
    const key = `${kind}:${id}`;
    if (!cover.has(key) || p.takenAt > cover.get(key).takenAt) cover.set(key, p);
  };
  for (const p of tagged) {
    const sp = new Set();
    const cv = new Set();
    for (const id of p.plantIds) {
      const pl = catalog.plants.get(id);
      if (!pl) continue;
      bump('plant', id, p);
      sp.add(pl.speciesId);
      if (pl.cultivarId) cv.add(pl.cultivarId);
    }
    sp.forEach((id) => bump('species', id, p));
    cv.forEach((id) => bump('cultivar', id, p));
    const places = new Set();
    for (const id of p.placeIds) {
      let cur = catalog.places.get(id);
      let guard = 0;
      while (cur && guard++ < 10) { places.add(cur.id); cur = cur.parentId ? catalog.places.get(cur.parentId) : null; }
    }
    places.forEach((id) => bump('place', id, p));
  }

  const page = h('div', { class: 'page' });
  page.append(h('header', { class: 'page-head' }, h('h1', null, 'Сезоны'),
    h('p', { class: 'muted' }, 'Выберите место или растение, чтобы увидеть его по годам и сезонам.')));
  page.append(h('a', { class: 'list-row stats-link', href: '#/stats' },
    h('div', { class: 'list-thumb' }, icon('grid', 22)),
    h('span', { class: 'list-text' }, h('span', { class: 'list-title' }, 'Фото по датам'), h('span', { class: 'list-sub' }, 'за какие месяцы и дни есть снимки')),
    icon('chevron', 18)));

  if (!tagged.length) {
    page.append(h('section', { class: 'empty' }, h('h2', null, 'Пока нечего показать'),
      h('p', null, 'Сетки строятся по размеченным фото. Отметьте несколько прогулок на экране «Разбор» — растения и клумбы появятся здесь.'),
      h('a', { class: 'btn primary', href: '#/queue' }, 'К разбору')));
    return page;
  }

  const search = h('input', { type: 'search', placeholder: 'Найти растение, сорт или место', 'aria-label': 'Поиск', autocomplete: 'off' });
  search.value = homeUi.query;
  const tabs = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Раздел' });
  const body = h('div', { class: 'list' });
  page.append(h('label', { class: 'search' }, icon('search', 18), search), tabs, body);

  const photosText = (n) => (n ? `${formatNumber(n)} ${plural(n, PHOTO_FORMS)}` : null);
  const row = (kind, id, { depth = 0, sub = null, toggle = null } = {}) => {
    const link = h('a', { class: 'list-row', href: `#/grid/${kind}/${id}`, style: depth ? { marginLeft: `${depth * 18}px` } : null },
      h('div', { class: 'list-thumb' }, cover.get(`${kind}:${id}`) ? photoImg(cover.get(`${kind}:${id}`).id) : icon(kind === 'place' ? 'pin' : 'leaf', 22)),
      h('span', { class: 'list-text' }, h('span', { class: 'list-title' }, kind === 'place' && catalog.places.get(id)?.kind === 'view' ? [icon('eye', 15), ' ', targetName(kind, id)] : targetName(kind, id)),
        h('span', { class: 'list-sub' }, [sub ?? targetSubtitle(kind, id), photosText(count[kind].get(id))].filter(Boolean).join(' · '))),
      toggle ? null : icon('chevron', 18));
    if (!toggle) return link;
    const open = homeUi.open.has(`${kind}:${id}`);
    return h('div', { class: 'group-row' }, link,
      h('button', {
        class: `drill${open ? ' open' : ''}`, type: 'button', 'aria-expanded': String(open), 'aria-label': `${open ? 'Свернуть' : 'Раскрыть'} «${targetName(kind, id)}»: ${toggle}`,
        onClick: () => { const k = `${kind}:${id}`; if (open) homeUi.open.delete(k); else homeUi.open.add(k); draw(); },
      }, h('span', null, String(toggle)), icon('chevron', 18)));
  };

  const drawPlaces = () => {
    const kids = (pid) => [...catalog.places.values()].filter((p) => (p.parentId || null) === pid && count.place.get(p.id))
      .sort((a, b) => (a.kind === 'view') - (b.kind === 'view') || a.name.localeCompare(b.name, 'ru'));
    const walk = (pid, depth) => {
      for (const p of kids(pid)) {
        const inner = kids(p.id);
        body.append(row('place', p.id, { depth, sub: p.kind === 'view' ? 'вид' : depth ? null : 'зона', toggle: inner.length || null }));
        if (inner.length && homeUi.open.has(`place:${p.id}`)) walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
  };

  const drawPlants = () => {
    const species = [...catalog.species.values()].filter((sp) => count.species.get(sp.id)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    for (const sp of species) {
      const plants = [...catalog.plants.values()].filter((p) => p.speciesId === sp.id && count.plant.get(p.id));
      const cultivars = [...catalog.cultivars.values()].filter((c) => c.speciesId === sp.id && count.cultivar.get(c.id));
      const inner = plants.length + cultivars.filter((c) => plantsOfTarget('cultivar', c.id).length > 1).length;
      const n = plantsOfTarget('species', sp.id).length;
      body.append(row('species', sp.id, { sub: [sp.latin, n > 1 ? `растений: ${n}` : null].filter(Boolean).join(' · ') || 'вид', toggle: inner > 1 ? inner : null }));
      if (inner > 1 && homeUi.open.has(`species:${sp.id}`)) {
        for (const c of cultivars) {
          if (plantsOfTarget('cultivar', c.id).length > 1) body.append(row('cultivar', c.id, { depth: 1, sub: `сорт · растений: ${plantsOfTarget('cultivar', c.id).length}` }));
        }
        for (const p of plants.sort((a, b) => varietyName(a).localeCompare(varietyName(b), 'ru') || placePath(a.placeId).localeCompare(placePath(b.placeId), 'ru'))) {
          body.append(row('plant', p.id, { depth: 1 }));
        }
      }
    }
  };

  const draw = () => {
    clear(body);
    const q = norm(homeUi.query);
    clear(tabs);
    tabs.hidden = !!q;
    tabs.append(
      h('button', { type: 'button', 'aria-pressed': String(homeUi.tab === 'places'), onClick: () => { homeUi.tab = 'places'; draw(); } }, 'Места'),
      h('button', { type: 'button', 'aria-pressed': String(homeUi.tab === 'plants'), onClick: () => { homeUi.tab = 'plants'; draw(); } }, 'Растения'));
    if (q) {
      // Поиск — плоским списком по всему
      const match = (kind, id, extra = '') => norm(`${targetName(kind, id)} ${targetSubtitle(kind, id)} ${extra}`).includes(q);
      const found = [
        ...[...catalog.places.values()].filter((p) => count.place.get(p.id) && match('place', p.id)).map((p) => ['place', p.id]),
        ...[...catalog.species.values()].filter((x) => count.species.get(x.id) && match('species', x.id, x.latin)).map((x) => ['species', x.id]),
        ...[...catalog.cultivars.values()].filter((x) => count.cultivar.get(x.id) && match('cultivar', x.id)).map((x) => ['cultivar', x.id]),
        ...[...catalog.plants.values()].filter((x) => count.plant.get(x.id) && match('plant', x.id)).map((x) => ['plant', x.id]),
      ];
      found.forEach(([k, id]) => body.append(row(k, id)));
      if (!found.length) body.append(h('p', { class: 'muted empty-note' }, 'Ничего не нашлось.'));
      return;
    }
    if (recent.length) {
      body.append(h('h3', { class: 'eyebrow' }, 'Недавно смотрели'));
      for (const t of recent.slice(0, 4)) body.append(row(t.kind, t.id));
      body.append(h('h3', { class: 'eyebrow' }, homeUi.tab === 'places' ? 'Все места' : 'Все растения'));
    }
    if (homeUi.tab === 'places') drawPlaces();
    else drawPlants();
  };
  search.addEventListener('input', () => { homeUi.query = search.value; draw(); });
  draw();
  return page;
}

// ======================= сетка =======================

function stateFor(key) {
  if (!gridState.has(key)) gridState.set(key, { mode: 'seasons', years: null, col: null, picking: false, picked: [] });
  return gridState.get(key);
}

export async function gridView(kind, id) {
  const page = h('div', { class: 'page' });
  page.append(h('a', { class: 'back-link', href: '#/seasons' }, icon('back', 20), 'Сезоны'));
  if (!targetExists(kind, id)) {
    page.append(h('section', { class: 'empty' }, h('h2', null, 'Не найдено'), h('p', null, 'Возможно, запись была удалена.')));
    return page;
  }
  rememberTarget(kind, id);
  const tkey = `${kind}:${id}`;
  const st = stateFor(tkey);
  const [photos, pins] = await Promise.all([photosForTarget(kind, id), getPins()]);
  const pinMap = Object.fromEntries(Object.entries(pins).filter(([k]) => k.startsWith(`${tkey}|`)).map(([k, v]) => [k.slice(tkey.length + 1), v]));

  const detailHref = { plant: `#/plant/${id}`, place: `#/place/${id}`, species: `#/species/${id}`, cultivar: `#/species/${catalog.cultivars.get(id)?.speciesId}` }[kind];
  page.append(h('header', { class: 'page-head tight' },
    h('h1', null, targetName(kind, id)),
    h('p', { class: 'muted' }, [targetSubtitle(kind, id), `${formatNumber(photos.length)} ${plural(photos.length, PHOTO_FORMS)}`].join(' · '))));

  const variety = kind === 'plant' ? comparableVariety(catalog.plants.get(id)) : (kind === 'cultivar' || kind === 'species') && plantsOfTarget(kind, id).length > 1 ? { kind, id } : null;
  page.append(h('div', { class: 'chips-row' },
    h('a', { class: 'pill', href: detailHref }, kind === 'place' ? 'Карточка места' : 'Карточка'),
    variety ? h('a', { class: 'pill', href: `#/compare/${variety.kind}/${variety.id}` }, 'Сравнить клумбы') : null));

  if (!photos.length) {
    page.append(h('p', { class: 'muted empty-note' }, 'Размеченных фото пока нет.'));
    return page;
  }

  // Режим: сезоны / месяцы, и фильтр одного сезона
  const isSeasonFilter = !['seasons', 'months'].includes(st.mode);
  const setMode = (m) => { st.mode = m; st.col = null; st.picked = []; rerender(); };
  page.append(h('div', { class: 'segmented', role: 'group', 'aria-label': 'Столбцы' },
    h('button', { type: 'button', 'aria-pressed': String(st.mode === 'seasons' || isSeasonFilter), onClick: () => setMode('seasons') }, 'Сезоны'),
    h('button', { type: 'button', 'aria-pressed': String(st.mode === 'months'), onClick: () => setMode('months') }, 'Месяцы')));

  const now = Date.now();
  const cur = seasonOf(now);
  const month = new Date(now).getMonth();
  page.append(h('div', { class: 'chips-row' },
    SEASON_CHIPS.map(([k, label]) => h('button', {
      class: 'pill', type: 'button', 'aria-pressed': String(st.mode === k),
      onClick: () => setMode(st.mode === k ? 'seasons' : k),
    }, `${label} по годам`))));

  const grid = buildGrid(photos, st.mode, { years: st.years, pins: pinMap, now });
  if (grid.years.length > 1) {
    page.append(h('div', { class: 'chips-row years' }, h('span', { class: 'muted small' }, 'Годы:'),
      grid.years.slice().reverse().map((y) => {
        const on = !st.years || st.years.has(y);
        return h('button', {
          class: 'pill', type: 'button', 'aria-pressed': String(on),
          onClick: () => {
            const set = new Set(st.years || grid.years);
            if (set.has(y)) set.delete(y); else set.add(y);
            st.years = set.size === grid.years.length ? null : set;
            rerender();
          },
        }, String(y));
      })));
  }

  // Сравнение двух ячеек
  const pickBar = h('div', { class: 'pick-bar' });
  const drawPickBar = () => {
    clear(pickBar);
    if (!st.picking) {
      pickBar.append(h('button', { class: 'btn small', type: 'button', onClick: () => { st.picking = true; st.picked = []; rerender(); } }, 'Сравнить два периода'));
      return;
    }
    pickBar.append(h('span', { class: 'small' }, st.picked.length < 2 ? `Выберите ${st.picked.length ? 'второй' : 'первый'} период` : 'Готово'),
      h('button', { class: 'btn small primary', type: 'button', disabled: st.picked.length < 2, onClick: () => { const [x, y] = st.picked; st.picking = false; st.picked = []; openCompare(x.cover, y.cover); rerender(); } }, 'Сравнить'),
      h('button', { class: 'btn small ghost', type: 'button', onClick: () => { st.picking = false; st.picked = []; rerender(); } }, 'Отмена'));
  };
  drawPickBar();

  let columns = grid.columns;
  if (st.col !== null && columns.some((c) => c.key === st.col)) columns = columns.filter((c) => c.key === st.col);
  else st.col = null;
  const single = columns.length === 1;
  const table = h('div', { class: `season-grid${st.mode === 'months' && !single ? ' months' : ''}${single ? ' single' : ''}`, style: { gridTemplateColumns: `44px repeat(${columns.length}, minmax(${st.mode === 'months' && !single ? '52px' : '0'}, 1fr))` } });
  table.append(h('span', null));
  for (const c of columns) {
    table.append(h('button', {
      class: `col-head${st.col === c.key ? ' on' : ''}`, type: 'button',
      title: st.col === c.key ? 'Показать все столбцы' : 'Показать только этот столбец',
      onClick: () => { st.col = st.col === c.key ? null : c.key; rerender(); },
    }, c.short));
  }
  for (const r of grid.rows) {
    table.append(h('span', { class: 'row-year' }, String(r.year)));
    for (const cell of r.cells.filter((x) => columns.some((c) => c.key === x.col))) table.append(gridCell(cell, st, tkey, drawPickBar));
  }
  page.append(pickBar, h('div', { class: 'grid-scroll' }, table));

  page.append(h('div', { class: 'chips-row' },
    h('span', { class: 'muted small' }, 'Быстро:'),
    h('button', { class: 'pill', type: 'button', onClick: () => setMode(cur.season) }, 'Этот сезон по годам'),
    h('button', { class: 'pill', type: 'button', onClick: () => { st.mode = 'months'; st.col = String(month); st.picked = []; rerender(); } }, 'Этот месяц по годам')));
  page.append(h('p', { class: 'muted small' }, 'Нажмите на ячейку, чтобы посмотреть все фото периода. На заголовок столбца — чтобы оставить только его.'));
  return page;
}

function gridCell(cell, st, tkey, drawPickBar) {
  if (cell.state !== 'photos') {
    return h('div', { class: `cell ${cell.state}`, 'aria-label': `${cell.label}: ${cell.state === 'future' ? 'ещё впереди' : 'нет фото'}` },
      cell.state === 'future' ? 'впереди' : 'нет фото');
  }
  const picked = st.picked.some((p) => p.key === cell.key);
  const el = h('button', { class: `cell photos${picked ? ' picked' : ''}`, type: 'button', 'aria-label': `${cell.label}, ${cell.photos.length} ${plural(cell.photos.length, PHOTO_FORMS)}` },
    photoImg(cell.cover.id), h('span', { class: 'cell-count' }, String(cell.photos.length)));
  el.addEventListener('click', () => {
    if (st.picking) {
      if (picked) st.picked = st.picked.filter((p) => p.key !== cell.key);
      else st.picked = [...st.picked, { key: cell.key, cover: cell.cover }].slice(-2);
      rerender();
      return;
    }
    const startIdx = Math.max(0, cell.photos.findIndex((p) => p.id === cell.cover.id));
    openViewer(cell.photos, startIdx, {
      onChange: () => rerender(),
      actions: [{
        label: 'Сделать обложкой периода',
        onClick: async (photo) => { await setPin(`${tkey}|${cell.key}`, photo.id); toast(`Обложка для «${cell.label}» закреплена`); rerender(); },
      }],
    });
  });
  return el;
}

// ======================= сравнение клумб =======================

const cmpState = new Map();

export async function compareView(kind, id) {
  const page = h('div', { class: 'page' });
  page.append(h('a', { class: 'back-link', href: `#/grid/${kind}/${id}` }, icon('back', 20), targetName(kind, id)));
  const plants = plantsOfTarget(kind, id);
  if (!targetExists(kind, id) || plants.length < 2) {
    page.append(h('section', { class: 'empty' }, h('h2', null, 'Нечего сравнивать'), h('p', null, 'Сравнение клумб доступно для сорта или вида, который растёт хотя бы в двух местах.')));
    return page;
  }
  const key = `${kind}:${id}`;
  if (!cmpState.has(key)) cmpState.set(key, { gran: 'seasons', hidden: new Set(), picking: false, picked: [] });
  const st = cmpState.get(key);
  const [lists, pins] = await Promise.all([Promise.all(plants.map((p) => photosForTarget('plant', p.id))), getPins()]);
  const groups = plants.map((p, i) => ({ id: p.id, plant: p, photos: lists[i] }))
    .sort((a, b) => placePath(a.plant.placeId).localeCompare(placePath(b.plant.placeId), 'ru'));

  page.append(h('header', { class: 'page-head tight' }, h('h1', null, 'Сравнение клумб'),
    h('p', { class: 'muted' }, `${targetName(kind, id)} · ${formatNumber(plants.length)} ${plural(plants.length, PLANT_FORMS)}`)));

  page.append(h('div', { class: 'chips-row' }, groups.map((g) => {
    const on = !st.hidden.has(g.id);
    return h('button', {
      class: 'pill', type: 'button', 'aria-pressed': String(on),
      onClick: () => { if (on) st.hidden.add(g.id); else st.hidden.delete(g.id); rerender(); },
    }, kind === 'species' && g.plant.cultivarId ? `${catalog.places.get(g.plant.placeId)?.name} · ${catalog.cultivars.get(g.plant.cultivarId)?.name}` : catalog.places.get(g.plant.placeId)?.name || 'Место');
  })));
  page.append(h('div', { class: 'segmented', role: 'group', 'aria-label': 'Периоды' },
    h('button', { type: 'button', 'aria-pressed': String(st.gran === 'seasons'), onClick: () => { st.gran = 'seasons'; rerender(); } }, 'По сезонам'),
    h('button', { type: 'button', 'aria-pressed': String(st.gran === 'months'), onClick: () => { st.gran = 'months'; rerender(); } }, 'По месяцам')));

  const shown = groups.filter((g) => !st.hidden.has(g.id));
  if (!shown.length) {
    page.append(h('p', { class: 'muted empty-note' }, 'Выберите хотя бы одну клумбу.'));
    return page;
  }
  const pinMap = Object.fromEntries(Object.entries(pins).filter(([k]) => k.startsWith(`cmp|`)).map(([k, v]) => [k.slice(4), v]));
  const rows = buildComparison(shown, st.gran, { pins: pinMap });

  const pickBar = h('div', { class: 'pick-bar' });
  if (!st.picking) {
    pickBar.append(h('button', { class: 'btn small', type: 'button', onClick: () => { st.picking = true; st.picked = []; rerender(); } }, 'Сравнить два фото'));
  } else {
    pickBar.append(h('span', { class: 'small' }, st.picked.length < 2 ? `Выберите ${st.picked.length ? 'второе' : 'первое'} фото` : 'Готово'),
      h('button', { class: 'btn small primary', type: 'button', disabled: st.picked.length < 2, onClick: () => { const [x, y] = st.picked; st.picking = false; st.picked = []; openCompare(x.cover, y.cover); rerender(); } }, 'Сравнить'),
      h('button', { class: 'btn small ghost', type: 'button', onClick: () => { st.picking = false; st.picked = []; rerender(); } }, 'Отмена'));
  }
  page.append(pickBar);

  const table = h('div', { class: 'compare-table', style: { gridTemplateColumns: `repeat(${shown.length}, minmax(150px, 1fr))` } });
  for (const g of shown) {
    table.append(h('a', { class: 'cmp-head', href: `#/plant/${g.id}` },
      h('strong', null, catalog.places.get(g.plant.placeId)?.name || 'Место'),
      h('span', { class: 'muted small' }, [kind === 'species' ? varietyName(g.plant) : null, `${formatNumber(g.photos.length)} ${plural(g.photos.length, PHOTO_FORMS)}`].filter(Boolean).join(' · '))));
  }
  for (const r of rows) {
    table.append(h('div', { class: 'cmp-period', style: { gridColumn: `1 / span ${shown.length}` } }, r.label));
    for (const c of r.cells) {
      if (!c.photos.length) {
        table.append(h('div', { class: 'cell empty tall' }, 'нет фото за этот период'));
        continue;
      }
      const ckey = `${r.key}:${c.groupId}`;
      const picked = st.picked.some((p) => p.key === ckey);
      const el = h('button', { class: `cell photos tall${picked ? ' picked' : ''}`, type: 'button', 'aria-label': `${r.label}, ${c.photos.length} ${plural(c.photos.length, PHOTO_FORMS)}` },
        photoImg(c.cover.id), h('span', { class: 'cell-count' }, String(c.photos.length)));
      el.addEventListener('click', () => {
        if (st.picking) {
          st.picked = picked ? st.picked.filter((p) => p.key !== ckey) : [...st.picked, { key: ckey, cover: c.cover }].slice(-2);
          rerender();
          return;
        }
        openViewer(c.photos, Math.max(0, c.photos.indexOf(c.cover)), {
          onChange: () => rerender(),
          actions: [{ label: 'Сделать обложкой периода', onClick: async (photo) => { await setPin(`cmp|${ckey}`, photo.id); toast('Обложка закреплена'); rerender(); } }],
        });
      });
      table.append(el);
    }
  }
  if (!rows.length) page.append(h('p', { class: 'muted empty-note' }, 'У выбранных клумб пока нет размеченных фото.'));
  else page.append(h('div', { class: 'grid-scroll' }, table));
  return page;
}

