// Слайд-шоу фото растения или места: все по порядку, один год или один сезон по годам.
import { h, icon, clear, openSheet } from '../ui/dom.js';
import { imageURL } from '../data/images.js';
import { formatDate, formatNumber, plural, PHOTO_FORMS } from '../lib/format.js';
import { SEASONS, seasonOf } from '../lib/seasons.js';
import { buildSlides, seasonLabel } from '../lib/slideshow.js';

export { buildSlides };

const SPEEDS = [2, 4, 6];
const settings = { speed: 4, mode: 'all', year: null, season: 'summer' }; // помним выбор до перезапуска

/** Панель настроек показа. */
export function openSlideshowSetup(photos, { title }) {
  if (!photos.length) return;
  const years = [...new Set(photos.map((p) => new Date(p.takenAt).getFullYear()))].sort((a, b) => b - a);
  const seasonsHere = SEASONS.filter((s) => photos.some((p) => seasonOf(p.takenAt).season === s.key));
  if (!years.includes(settings.year)) settings.year = years[0];
  if (!seasonsHere.some((s) => s.key === settings.season)) settings.season = seasonsHere[0].key;

  openSheet((close) => {
    const root = h('div', { class: 'form slideshow-setup' });
    const draw = () => {
      clear(root);
      const pills = (items, cur, set) => h('div', { class: 'chips-row' }, items.map(([v, label]) => h('button', {
        class: 'pill', type: 'button', 'aria-pressed': String(cur === v), onClick: () => { set(v); draw(); },
      }, label)));
      const slides = buildSlides(photos, settings);
      const n = slides.filter((s) => s.photo).length;
      root.append(...[
        h('h2', { class: 'sheet-title' }, 'Слайд-шоу'),
        h('p', { class: 'muted' }, title),
        h('div', { class: 'field' }, h('span', null, 'Что показать'),
          pills([['all', 'Все фото'], ['year', 'Один год'], ['season', 'Сезон по годам']], settings.mode, (v) => { settings.mode = v; })),
        settings.mode === 'year' ? pills(years.map((y) => [y, String(y)]), settings.year, (v) => { settings.year = v; }) : null,
        settings.mode === 'season' ? pills(seasonsHere.map((s) => [s.key, s.name]), settings.season, (v) => { settings.season = v; }) : null,
        h('div', { class: 'field' }, h('span', null, 'Скорость'),
          pills(SPEEDS.map((s) => [s, `${s} сек`]), settings.speed, (v) => { settings.speed = v; })),
        h('button', {
          class: 'btn primary block', type: 'button', disabled: !n,
          onClick: () => { close(); playSlideshow(slides, { title, speed: settings.speed }); },
        }, icon('play', 20), n ? `Смотреть · ${formatNumber(n)} ${plural(n, PHOTO_FORMS)}` : 'Нет фото'),
      ].filter(Boolean));
    };
    draw();
    return root;
  }, { label: 'Слайд-шоу' });
}

/** Полноэкранный показ. */
export function playSlideshow(slides, { title, speed = 4 }) {
  let i = 0;
  let playing = true;
  let timer = null;
  let wake = null;
  const prevFocus = document.activeElement;
  const overlay = h('div', { class: 'viewer slideshow', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Слайд-шоу' });
  const layers = [h('div', { class: 'ss-layer' }), h('div', { class: 'ss-layer' })];
  let front = 0;
  const stage = h('div', { class: 'ss-stage' }, ...layers);
  const caption = h('div', { class: 'ss-caption' });
  const bar = h('div', { class: 'ss-progress' }, h('div'));
  const playBtn = h('button', { class: 'icon-btn ss-btn', type: 'button', 'aria-label': 'Пауза' }, icon('pause'));

  const lockScreen = async () => { try { wake = await navigator.wakeLock?.request('screen'); } catch { wake = null; } };
  const releaseScreen = () => { wake?.release?.().catch(() => {}); wake = null; };
  const onVisible = () => { if (document.visibilityState === 'visible' && playing) lockScreen(); };

  const close = () => {
    clearTimeout(timer);
    releaseScreen();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    prevFocus?.focus?.();
  };

  let renderToken = 0;
  const render = async (slide) => {
    const token = ++renderToken;
    let content;
    if (slide.divider) {
      content = h('div', { class: 'ss-divider' }, h('strong', null, slide.divider), h('span', null, `${formatNumber(slide.count)} ${plural(slide.count, PHOTO_FORMS)}`));
    } else {
      const url = await imageURL(slide.photo.id, 'f') || await imageURL(slide.photo.id, 't');
      content = h('img', { class: 'viewer-img', alt: '', src: url || '' });
      await content.decode().catch(() => {});
    }
    if (token !== renderToken) return; // пока грузилось, уже перелистнули дальше
    const back = layers[1 - front];
    clear(back).append(content);
    back.classList.add('on');
    layers[front].classList.remove('on');
    front = 1 - front;
    if (slide.divider) caption.textContent = '';
    else {
      const s = seasonOf(slide.photo.takenAt);
      caption.textContent = `${formatDate(slide.photo.takenAt)} · ${seasonLabel(s.season, s.year)}`;
    }
    // Заранее подгрузить следующее фото
    const next = slides.slice(i + 1).find((x) => x.photo);
    if (next) imageURL(next.photo.id, 'f').then((u) => { if (u) { const im = new Image(); im.src = u; } });
  };

  const schedule = () => {
    clearTimeout(timer);
    const fill = bar.firstChild;
    fill.style.transition = 'none';
    fill.style.width = `${(i / slides.length) * 100}%`;
    if (!playing) return;
    const ms = slides[i].divider ? Math.max(1500, speed * 500) : speed * 1000;
    requestAnimationFrame(() => {
      fill.style.transition = `width ${ms}ms linear`;
      fill.style.width = `${((i + 1) / slides.length) * 100}%`;
    });
    timer = setTimeout(() => {
      if (i < slides.length - 1) go(1);
      else { playing = false; syncPlay(); caption.textContent = 'Конец показа · коснитесь, чтобы начать сначала'; }
    }, ms);
  };
  const go = async (d) => {
    const ni = i + d;
    if (ni < 0 || ni >= slides.length) return;
    i = ni;
    await render(slides[i]);
    schedule();
  };
  const syncPlay = () => {
    clear(playBtn).append(icon(playing ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', playing ? 'Пауза' : 'Продолжить');
    if (playing) lockScreen(); else releaseScreen();
  };
  const toggle = () => {
    if (!playing && i >= slides.length - 1) { i = -1; playing = true; syncPlay(); go(1); return; }
    playing = !playing;
    syncPlay();
    schedule();
  };
  playBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });

  // Касание — пауза, свайп — листать
  let sx = null;
  stage.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) > 50) { e.preventDefault(); go(dx < 0 ? 1 : -1); }
  });
  stage.addEventListener('click', toggle);
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === ' ') { e.preventDefault(); toggle(); }
  };

  overlay.append(
    h('div', { class: 'viewer-top' }, h('span', { class: 'ss-title' }, title),
      h('div', { class: 'ss-controls' }, playBtn,
        h('button', { class: 'icon-btn ss-btn', type: 'button', 'aria-label': 'Закрыть', onClick: close }, icon('close')))),
    bar, stage, caption);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisible);
  lockScreen();
  render(slides[0]).then(schedule);
  return { close };
}
