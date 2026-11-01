// Сквозной тест версии 0.2: сетка сезонов, «весна по годам», сравнение клумб и двух фото.
// Запуск: PW=… PHOTOS2=/путь/к/фото/двух/клумб node tests/e2e/seasons.mjs (сервер на :8080)
import { readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://localhost:8080/';
const PHOTOS = process.env.PHOTOS2;
const SHOTS = process.env.SHOTS || '/tmp/shots2';
mkdirSync(SHOTS, { recursive: true });
const files = readdirSync(PHOTOS).map((f) => join(PHOTOS, f));

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
await ctx.addInitScript(() => {
  // Фиксируем «сегодня» = 31 октября 2026, чтобы будущие ячейки были предсказуемы
  const fixed = new Date(2026, 9, 31, 12).getTime();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [fixed])); }
    static now() { return fixed; }
  }
  globalThis.Date = FakeDate;
});
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
let step = 0;
const shot = (name) => page.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, '0')}-${name}.png` });
const check = async (cond, msg) => {
  if (!cond) { await page.screenshot({ path: `${SHOTS}/FAIL.png` }); throw new Error(`ПРОВАЛ: ${msg}`); }
  console.log(`✓ ${msg}`);
};

// Подготовка: импорт и разметка через модули приложения
await page.goto(BASE);
await page.locator('input[type=file]').first().setInputFiles(files);
await page.getByText('Импорт завершён').waitFor({ timeout: 60000 });
const ids = await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const porch = await s.createPlace({ name: 'У крыльца' });
  const fence = await s.createPlace({ name: 'У забора' });
  const sp = await s.createSpecies({ name: 'Хоста', latin: 'Hosta' });
  const cv = await s.createCultivar({ speciesId: sp.id, name: 'June' });
  const a = await s.createPlant({ speciesId: sp.id, cultivarId: cv.id, placeId: porch.id });
  const b = await s.createPlant({ speciesId: sp.id, cultivarId: cv.id, placeId: fence.id });
  const fresh = await s.photosByStatus('new');
  await s.tagPhotos(fresh.filter((p) => p.fileName.startsWith('A_')).map((p) => p.id), { plantIds: [a.id] });
  await s.tagPhotos(fresh.filter((p) => p.fileName.startsWith('B_')).map((p) => p.id), { plantIds: [b.id] });
  return { a: a.id, b: b.id, cv: cv.id };
});
await check(true, 'данные подготовлены: 2 клумбы, сорт в обеих, 15 фото за 2024–2026');

// Экран «Сезоны»
await page.goto(`${BASE}#/seasons`);
await page.getByRole('heading', { name: 'Сезоны' }).waitFor();
await page.locator('.list-row', { hasText: 'У крыльца' }).first().waitFor();
await check((await page.locator('#view .list .list-row').count()) === 2, 'вкладка «Места»: две клумбы');
await page.getByRole('button', { name: 'Растения', exact: true }).click();
await page.waitForTimeout(200);
await check((await page.locator('#view .list > .group-row, #view .list > .list-row').count()) === 1, 'вкладка «Растения»: один вид, свёрнут');
await page.getByRole('button', { name: /Раскрыть «Хоста»/ }).click();
await page.waitForTimeout(200);
const inner = await page.locator('#view .list .list-title').allTextContents();
await check(inner.includes('Хоста «June»') && inner.filter((t) => t === 'Хоста «June»').length === 3, `вид раскрывается: сорт и два растения (${inner.join(', ')})`);
await shot('seasons-home');

// Фото по датам
await page.getByRole('link', { name: /Фото по датам/ }).click();
await page.getByRole('heading', { name: 'Фото по датам' }).waitFor();
const cells = await page.locator('.cal-cell:not(.empty)').count();
await check(cells === 12, `в календаре месяцев с фото: ${cells}`);
await page.getByRole('button', { name: /^май 2025/ }).click();
await page.locator('#month-detail').waitFor();
const dayRows = await page.locator('.day-row').count();
await check(dayRows === 2, `в мае 2025 дней со съёмкой: ${dayRows}`);
await shot('stats');

// Сетка растения у крыльца
await page.goto(`${BASE}#/grid/plant/${ids.a}`);
await page.locator('.season-grid').waitFor();
const years = await page.locator('.row-year').allTextContents();
await check(years.join(',') === '2026,2025,2024', `годы по убыванию: ${years}`);
const counts = await page.locator('.season-grid > *').evaluateAll((els) => els.map((e) => e.classList.contains('row-year') ? '|' : e.classList.contains('col-head') || !e.className ? '' : e.querySelector('.cell-count')?.textContent || (e.classList.contains('future') ? 'F' : '0')).filter(Boolean).join(' '));
await check(counts === '| 2 1 0 F | 3 1 1 1 | 2 1 0 0', `ячейки сезонов: ${counts}`);
await shot('grid-seasons');

// Весна по годам
await page.getByRole('button', { name: 'Весна по годам' }).click();
await page.waitForTimeout(200);
const heads = await page.locator('.col-head').allTextContents();
await check(heads.join(',') === 'март,апрель,май', `столбцы весны: ${heads}`);
await shot('grid-spring');

// Фильтр лет: убрать 2024
await page.locator('.years').getByRole('button', { name: '2024' }).click();
await page.waitForTimeout(200);
await check((await page.locator('.row-year').count()) === 2, 'после снятия 2024 осталось 2 года');

// Один столбец — май
await page.getByRole('button', { name: 'май', exact: true }).click();
await page.waitForTimeout(200);
await check((await page.locator('.col-head').count()) === 1, 'остался один столбец «май»');
await shot('grid-may');

// Обложка периода
await page.locator('.cell.photos').first().click();
await page.locator('.viewer-img').waitFor();
await page.getByRole('button', { name: 'Сделать обложкой периода' }).click();
await page.getByText(/Обложка для «май 2026» закреплена/).waitFor();
await check(true, 'обложка периода закреплена');
await page.keyboard.press('Escape');

// Прокрутка сетки месяцев не сбрасывается при выборе ячейки
await page.locator('.col-head.on').click(); // вернуть все столбцы
await page.getByRole('button', { name: 'Месяцы', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Сравнить два периода' }).click();
await page.waitForTimeout(300);
await page.locator('.grid-scroll').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
const sx = await page.locator('.grid-scroll').evaluate((el) => el.scrollLeft);
await page.locator('.cell.photos').last().click();
await page.waitForTimeout(300);
const sx2 = await page.locator('.grid-scroll').evaluate((el) => el.scrollLeft);
await check(sx > 0 && Math.abs(sx2 - sx) < 2, `прокрутка сетки сохраняется при выборе (${sx} → ${sx2})`);
await page.getByRole('button', { name: 'Отмена' }).click();
await page.getByRole('button', { name: 'Сезоны', exact: true }).click();

// Сравнение двух периодов
await page.getByRole('button', { name: 'Сравнить два периода' }).click();
await page.locator('.cell.photos').nth(0).click();
await page.locator('.cell.photos').nth(1).click();
await page.getByRole('button', { name: 'Сравнить', exact: true }).click();
await page.locator('.pair-row').first().waitFor();
const pairCount = await page.locator('.pair-row').count();
await check(pairCount >= 1, `шаг «Похожие ракурсы»: пар ${pairCount}`);
await page.waitForTimeout(300);
await shot('pairs');
// Оценка 👎 убирает пару из подсказок
await page.locator('.pair-row').first().getByRole('button', { name: 'Плохая пара' }).click();
await check((await page.locator('.pair-row').first().textContent()).includes('больше не предложу'), '👎 отмечает пару');
await page.waitForTimeout(300);
const votes = await page.evaluate(async () => (await (await import('/js/data/viewFeedback.js')).loadVotes()).length);
await check(votes === 1, 'оценка сохранена');
await page.locator('.pair-row').first().getByRole('button', { name: 'Плохая пара' }).click();
await page.locator('.pair-row').first().getByRole('button', { name: 'Хорошая пара' }).click();
await check((await page.locator('.pair-row').first().textContent()).includes('закреплена'), '👍 отмечает пару');
await page.locator('.pair-thumbs').first().click();
await page.locator('.compare-body.side img').first().waitFor();
await page.waitForTimeout(300);
await shot('compare-side');
await check((await page.locator('.cmp-vote').textContent()).includes('закреплена'), 'в сравнении видна оценка пары');
await page.locator('.cmp-vote').getByRole('button', { name: 'Хорошая пара' }).click();
await page.waitForTimeout(200);
await check((await page.locator('.cmp-vote').textContent()).includes('Удачная пара?'), '👍 в сравнении снимается повторным нажатием');
await page.locator('.cmp-vote').getByRole('button', { name: 'Хорошая пара' }).click();
await page.getByRole('button', { name: 'Шторка' }).click();
await page.locator('.cmp-frame').waitFor();
await page.waitForTimeout(300);
await shot('compare-slider');
await check(true, 'сравнение двух фото: рядом и шторкой');
await page.getByRole('button', { name: 'Пары', exact: true }).click();
await check(await page.locator('.compare').count() === 0 && await page.locator('.pairs').count() === 1, '«Другая пара» возвращает к выбору пар');
await page.locator('.pair-manual summary').click();
await page.locator('.pair-side').nth(0).locator('.thumb').first().click();
await page.locator('.pair-side').nth(1).locator('.thumb').last().click();
await page.locator('.pair-manual').getByRole('button', { name: 'Сравнить', exact: true }).click();
await page.locator('.compare-body img').first().waitFor();
await check(true, 'пару можно выбрать вручную');
await page.getByRole('button', { name: 'Пары', exact: true }).click();
await page.locator('.pair-side').nth(0).locator('.thumb').first().click();
await page.locator('.pair-side').nth(1).locator('.thumb').last().click();
await page.getByRole('button', { name: 'Закрепить в подсказках' }).click();
await page.waitForTimeout(300);
await check((await page.locator('.pair-row').first().textContent()).includes('закреплена'), 'ручная пара закреплена первой в подсказках');
await page.locator('.pair-thumbs').first().click();
await page.locator('.compare-body img').first().waitFor();
await page.locator('.compare').getByRole('button', { name: 'Закрыть' }).click();
await check(await page.locator('.compare, .pairs').count() === 0, 'крестик закрывает сравнение целиком');

// Сравнение клумб
await page.goto(`${BASE}#/compare/cultivar/${ids.cv}`);
await page.locator('.compare-table').waitFor();
const heads2 = await page.locator('.cmp-head strong').allTextContents();
await check(heads2.join(',') === 'У забора,У крыльца', `колонки клумб: ${heads2}`);
const periods = await page.locator('.cmp-period').allTextContents();
await check(periods[0] === 'лето 2026' && periods.includes('весна 2025') && periods.at(-1) === 'весна 2024', `периоды: ${periods.join(', ')}`);
await shot('compare-beds');
await page.getByRole('button', { name: 'По месяцам' }).click();
await page.waitForTimeout(200);
await check((await page.locator('.cmp-period').first().textContent()) === 'август 2026', 'по месяцам: первым август 2026');

// Карточка растения: ссылки и фильтр по году
await page.goto(`${BASE}#/plant/${ids.a}`);
await page.getByRole('link', { name: 'Сетка сезонов' }).waitFor();
await check(await page.getByRole('link', { name: 'Сравнить клумбы' }).isVisible(), 'на карточке есть «Сравнить клумбы»');
await page.locator('.chips-row').getByRole('button', { name: '2025' }).click();
await page.waitForTimeout(200);
await check((await page.locator('.photo-grid .tile').count()) === 5, 'фильтр по году: в 2025 году 5 фото у крыльца');
await shot('plant-2025');

// Компьютер, тёмная тема, месяцы
await page.emulateMedia({ colorScheme: 'dark' });
await page.setViewportSize({ width: 1280, height: 860 });
await page.goto(`${BASE}#/grid/plant/${ids.a}`);
await page.getByRole('button', { name: 'Месяцы' }).click();
await page.waitForTimeout(500);
await shot('desktop-months-dark');

await check(errors.length === 0, `нет ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log('ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
