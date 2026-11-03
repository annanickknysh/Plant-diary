// «Избранные пары» — зал славы: все пары, отмеченные 👍, по местам и растениям.
import { h, icon, photoImg } from '../ui/dom.js';
import { catalog, getPhoto, placePath, varietyName } from '../data/store.js';
import { loadVotes, setVote } from '../data/viewFeedback.js';
import { formatDate, formatNumber, plural } from '../lib/format.js';
import { openCompare } from './comparePhotos.js';
import { rerender } from '../app.js';

const PAIR_FORMS = ['пара', 'пары', 'пар'];

/** Подпись группы: общий вид или клумба (самое «узкое» место), иначе общие растения. */
function groupOf(a, b) {
  const common = a.placeIds.filter((id) => b.placeIds.includes(id) && catalog.places.has(id));
  const view = common.find((id) => catalog.places.get(id).kind === 'view');
  if (view) return { key: `place:${view}`, title: catalog.places.get(view).name, sub: catalog.places.get(view).parentId ? placePath(catalog.places.get(view).parentId) : 'вид', view: true };
  if (common.length) {
    // Самое вложенное место
    const depth = (id) => placePath(id).split(' › ').length;
    const id = common.sort((x, y) => depth(y) - depth(x))[0];
    return { key: `place:${id}`, title: catalog.places.get(id).name, sub: placePath(id) };
  }
  const plants = a.plantIds.filter((id) => b.plantIds.includes(id) && catalog.plants.has(id));
  if (plants.length) return { key: `plant:${plants[0]}`, title: varietyName(catalog.plants.get(plants[0])), sub: placePath(catalog.plants.get(plants[0]).placeId) };
  return { key: 'other', title: 'Разные места', sub: '' };
}

export async function favoritesView() {
  const page = h('div', { class: 'page' });
  page.append(h('a', { class: 'back-link', href: '#/seasons' }, icon('back', 20), 'Сезоны'),
    h('header', { class: 'page-head tight' }, h('h1', null, 'Избранные пары'),
      h('p', { class: 'muted' }, 'Пары фото, которые вы отметили 👍 при сравнении периодов. Нажмите, чтобы сравнить снова.')));

  const votes = (await loadVotes()).filter((v) => v.good).sort((x, y) => (y.at || 0) - (x.at || 0));
  const pairs = [];
  for (const v of votes) {
    const [ida, idb] = v.k.split('|');
    const [a, b] = await Promise.all([getPhoto(ida), getPhoto(idb)]);
    if (!a || !b) continue;
    const [first, second] = a.takenAt <= b.takenAt ? [a, b] : [b, a];
    pairs.push({ a: first, b: second, group: groupOf(first, second) });
  }
  if (!pairs.length) {
    page.append(h('section', { class: 'empty' },
      h('h2', null, 'Пока пусто'),
      h('p', null, 'Откройте «Сезоны» → место или растение → «Сравнить два периода». На экране «Похожие ракурсы» или в самом сравнении нажмите 👍 у удачной пары — она появится здесь.')));
    return page;
  }

  const groups = new Map();
  for (const p of pairs) {
    if (!groups.has(p.group.key)) groups.set(p.group.key, { ...p.group, items: [] });
    groups.get(p.group.key).items.push(p);
  }
  page.append(h('p', { class: 'muted small' }, `${formatNumber(pairs.length)} ${plural(pairs.length, PAIR_FORMS)} в ${formatNumber(groups.size)} ${plural(groups.size, ['месте', 'местах', 'местах'])}`));

  const thumb = (p) => h('span', { class: 'pair-photo' }, photoImg(p.id), h('span', { class: 'pair-date' }, formatDate(p.takenAt)));
  for (const g of groups.values()) {
    const sec = h('section', { class: 'fav-group' },
      h('h2', { class: 'section-title' }, g.view ? [icon('eye', 16), ' ', g.title] : g.title),
      g.sub && g.sub !== g.title ? h('p', { class: 'muted small' }, g.sub) : null);
    for (const p of g.items) {
      const years = new Date(p.b.takenAt).getFullYear() - new Date(p.a.takenAt).getFullYear();
      sec.append(h('button', {
        class: 'fav-pair', type: 'button', 'aria-label': `Сравнить ${formatDate(p.a.takenAt)} и ${formatDate(p.b.takenAt)}`,
        onClick: () => openCompare(p.a, p.b, {
          onClose: () => rerender(),
          vote: { get: () => true, set: (good) => setVote(p.a.id, p.b.id, good, null) },
        }),
      }, h('span', { class: 'pair-thumbs' }, thumb(p.a), thumb(p.b)),
      h('span', { class: 'fav-meta' }, years > 0 ? `разница ${years} ${plural(years, ['год', 'года', 'лет'])}` : 'один год')));
    }
    page.append(sec);
  }
  return page;
}
