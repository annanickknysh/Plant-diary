// Точка входа: загрузка каталога, навигация, панель импорта.
import { openDB } from './data/db.js';
import { loadCatalog, bus, countPhotos } from './data/store.js';
import { importState } from './data/importer.js';
import { h, clear, icon } from './ui/dom.js';
import { formatNumber } from './lib/format.js';
import { queueView } from './views/queue.js';
import { walkView } from './views/walk.js';
import { catalogView, speciesView, placeView, plantView } from './views/catalog.js';
import { moreView, hiddenView } from './views/more.js';
import { seasonsHome, gridView, compareView } from './views/seasons.js';
import { placeTaggingView } from './views/placeTagging.js';
import { journalView } from './views/journal.js';
import { statsView } from './views/stats.js';
import { indexAll } from './data/similarity.js';

const routes = [
  { re: /^\/queue$/, view: queueView, tab: 'queue' },
  { re: /^\/walk\/([\w-]+)$/, view: walkView, tab: 'queue', full: true },
  { re: /^\/catalog(?:\/(plants|places))?$/, view: catalogView, tab: 'catalog' },
  { re: /^\/species\/([\w-]+)$/, view: speciesView, tab: 'catalog' },
  { re: /^\/place\/([\w-]+)$/, view: placeView, tab: 'catalog' },
  { re: /^\/plant\/([\w-]+)$/, view: plantView, tab: 'catalog' },
  { re: /^\/tagplace\/([\w-]+)$/, view: placeTaggingView, tab: 'catalog', full: true },
  { re: /^\/seasons$/, view: seasonsHome, tab: 'seasons' },
  { re: /^\/stats$/, view: statsView, tab: 'seasons' },
  { re: /^\/grid\/(plant|cultivar|species|place)\/([\w-]+)$/, view: gridView, tab: 'seasons' },
  { re: /^\/compare\/(cultivar|species)\/([\w-]+)$/, view: compareView, tab: 'seasons' },
  { re: /^\/camera(?:\/(plant|place)\/([\w-]+))?$/, view: journalView, tab: 'camera' },
  { re: /^\/more$/, view: moreView, tab: 'more' },
  { re: /^\/hidden$/, view: hiddenView, tab: 'more' },
];

const TABS = [
  { key: 'queue', label: 'Разбор', icon: 'inbox', href: '#/queue' },
  { key: 'seasons', label: 'Сезоны', icon: 'grid', href: '#/seasons' },
  { key: 'catalog', label: 'Каталог', icon: 'leaf', href: '#/catalog' },
  { key: 'camera', label: 'Дневник', icon: 'camera', href: '#/camera' },
  { key: 'more', label: 'Ещё', icon: 'more', href: '#/more' },
];

const root = document.getElementById('app');
const viewHost = h('main', { id: 'view', tabindex: '-1' });
const banner = h('div', { id: 'import-banner', hidden: true });
const nav = h('nav', { id: 'tabbar', 'aria-label': 'Основная навигация' });
let currentRoute = null;
let renderToken = 0;

function buildNav(activeTab, freshCount) {
  clear(nav);
  for (const t of TABS) {
    const active = t.key === activeTab;
    const badge = t.key === 'queue' && freshCount > 0
      ? h('span', { class: 'badge', 'aria-label': `${freshCount} неразобранных` }, freshCount >= 1000 ? `${(freshCount / 1000).toFixed(1).replace('.', ',')}к` : String(freshCount))
      : null;
    nav.append(h('a', { href: t.href, class: `tab${active ? ' active' : ''}`, 'aria-current': active ? 'page' : null }, icon(t.icon, 24), h('span', null, t.label), badge));
  }
}

async function refreshNav() {
  const { fresh } = await countPhotos();
  buildNav(currentRoute?.tab, fresh);
}

async function render() {
  const path = location.hash.replace(/^#/, '') || '/queue';
  let match = null;
  let route = null;
  for (const r of routes) {
    match = path.match(r.re);
    if (match) { route = r; break; }
  }
  if (!route) {
    location.replace('#/queue');
    return;
  }
  currentRoute = route;
  document.body.classList.toggle('fullscreen-route', !!route.full);
  const token = ++renderToken;
  let el;
  try {
    el = await route.view(...match.slice(1));
  } catch (e) {
    console.error(e);
    el = h('div', { class: 'page' }, h('h1', null, 'Что-то пошло не так'), h('p', { class: 'muted' }, String(e.message || e)));
  }
  if (token !== renderToken) return; // уже ушли на другой экран
  clear(viewHost).append(el);
  viewHost.scrollTop = 0;
  window.scrollTo(0, 0);
  refreshNav();
}

/** Перерисовать текущий экран, сохранив прокрутку. */
export async function rerender() {
  const y = window.scrollY;
  await render();
  window.scrollTo(0, y);
}

function updateBanner(st) {
  if (!st || (!st.running && !st.finishedAt)) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  clear(banner);
  if (st.running) {
    const pct = st.total ? Math.round((st.processed / st.total) * 100) : 0;
    banner.className = 'running';
    banner.append(
      h('div', { class: 'banner-row' },
        h('strong', null, `Импорт: ${formatNumber(st.processed)} из ${formatNumber(st.total)}`),
        h('span', { class: 'muted' }, `${pct}%`)),
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('div', { style: { width: `${pct}%` } })),
    );
  } else {
    banner.className = 'done';
    const parts = [`добавлено ${formatNumber(st.added)}`];
    if (st.duplicates) parts.push(`уже были ${formatNumber(st.duplicates)}`);
    if (st.deletedBefore) parts.push(`удалены раньше ${formatNumber(st.deletedBefore)}`);
    if (st.noDate) parts.push(`без даты ${formatNumber(st.noDate)}`);
    if (st.failed.length) parts.push(`не прочитано ${formatNumber(st.failed.length)}`);
    if (st.skipped) parts.push(`пропущено не-фото ${formatNumber(st.skipped)}`);
    const details = st.failed.length
      ? h('details', null, h('summary', null, 'Какие файлы не прочитались'),
        h('ul', null, st.failed.slice(0, 50).map((f) => h('li', null, `${f.name} — ${f.reason}`))))
      : null;
    banner.append(
      h('div', { class: 'banner-row' },
        h('strong', null, 'Импорт завершён'),
        h('button', { class: 'icon-btn', 'aria-label': 'Скрыть', onClick: () => { importState.finishedAt = 0; banner.hidden = true; } }, icon('close', 18))),
      h('p', null, `${parts.join(' · ')}.`),
    );
    if (details) banner.append(details);
  }
}

async function start() {
  root.append(banner, viewHost, nav);
  try {
    await openDB();
    await loadCatalog();
  } catch (e) {
    window.__rescue?.(`Хранилище: ${e.message}`);
    return;
  }
  // Просим браузер не очищать данные при нехватке места.
  navigator.storage?.persist?.().catch(() => {});

  bus.addEventListener('import', (e) => {
    updateBanner(e.detail);
    if (!e.detail.running) setTimeout(() => indexAll().catch(() => {}), 1000);
    if (!e.detail.running && currentRoute && ['queue', 'more', 'camera'].includes(currentRoute.tab) && !currentRoute.full) rerender();
    else refreshNav();
  });
  bus.addEventListener('photos', () => refreshNav());
  window.addEventListener('hashchange', () => {
    document.getElementById('toast')?.classList.remove('show');
    render();
  });
  await render();
  window.__appStarted = true;
  // Отпечатки для подсказок считаются в фоне, когда приложение уже открылось
  setTimeout(() => indexAll().catch(() => {}), 4000);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return; // первая установка, обновлять нечего
      showUpdateBar();
    });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
      // Проверять обновление при каждом возвращении в приложение и раз в час
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(() => {});
  }
}

/** Панель «Вышла новая версия» — не исчезает сама, пока не обновят. */
function showUpdateBar() {
  if (document.getElementById('update-bar')) return;
  const bar = h('div', { id: 'update-bar', role: 'status' },
    h('span', null, 'Вышла новая версия приложения'),
    h('button', { class: 'btn small primary', type: 'button', onClick: () => location.reload() }, 'Обновить'));
  document.body.append(bar);
}

start();
