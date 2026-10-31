// Сквозной тест 0.6.1: смена вида и сорта растения, создание из поиска, исправление названия,
// перенос текста поиска в форму создания растения при разметке.
// Запуск: PW=… PHOTOS2=… node tests/e2e/variety.mjs (сервер на :8080)
import { readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '/tmp/shots-variety';
mkdirSync(SHOTS, { recursive: true });
const files = readdirSync(process.env.PHOTOS2).map((f) => join(process.env.PHOTOS2, f)).slice(0, 4);

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU' });
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
const top = () => page.locator('.sheet-overlay').last();

await page.goto(BASE);
await page.locator('input[type=file]').first().setInputFiles(files);
await page.getByText('Импорт завершён').waitFor({ timeout: 60000 });
const ids = await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const bed = await s.createPlace({ name: 'Возле бани' });
  const sp = await s.createSpecies({ name: 'Дайкон' });
  await s.createSpecies({ name: 'Пион' });
  const plant = await s.createPlant({ speciesId: sp.id, placeId: bed.id });
  const fresh = await s.photosByStatus('new');
  await s.tagPhotos([fresh[0].id], { placeId: bed.id });
  return { plant: plant.id, photo: fresh[1].id };
});

// 1. Смена вида на новый, созданный из поиска
await page.goto(`${BASE}#/plant/${ids.plant}`);
await page.getByRole('button', { name: 'Изменить' }).click();
await top().locator('.place-field', { hasText: 'Дайкон' }).click();
await top().locator('input[type=search]').fill('редис');
await shot('species-search');
await top().getByRole('button', { name: 'Создать вид «Редис»' }).click();
await page.locator('.place-field', { hasText: 'Редис' }).waitFor();
await check(await page.locator('.place-field', { hasText: 'Редис' }).count() === 1, 'новый вид создан из поиска и выбран');

// 2. Новый сорт из поиска
await top().locator('.place-field', { hasText: 'Без сорта' }).click();
await top().locator('input[type=search]').fill('жара');
await top().getByRole('button', { name: 'Создать сорт «Жара»' }).click();
await page.locator('.place-field', { hasText: 'Жара' }).waitFor();
await check(await page.locator('.place-field', { hasText: 'Жара' }).count() === 1, 'новый сорт создан и выбран');

// 3. Исправить название сорта
await top().locator('.place-field', { hasText: 'Жара' }).click();
await top().getByRole('button', { name: 'Исправить название «Жара»' }).click();
await top().locator('input').first().fill('Жара F1');
await top().getByRole('button', { name: 'Сохранить' }).click();
await page.waitForTimeout(200);
await check(await top().getByText('Жара F1').count() >= 1, 'название сорта исправлено в списке');
await top().getByRole('button', { name: /Жара F1/ }).first().click();
await page.locator('.place-field', { hasText: 'Жара F1' }).waitFor();
await page.waitForTimeout(300);
await shot('form');
await top().getByRole('button', { name: 'Сохранить' }).click();
await page.waitForTimeout(400);
const h1 = await page.locator('h1').textContent();
await check(h1 === 'Редис «Жара F1»', `растение сохранено: ${h1}`);

// 4. Разметка: текст поиска переносится в форму создания
await page.goto(`${BASE}#/queue`);
await page.evaluate(async (id) => {
  const { openTagSheet } = await import('/js/views/tagSheet.js');
  const { getAll, STORES } = await import('/js/data/db.js');
  const p = (await getAll(STORES.photos)).find((x) => x.id === id);
  openTagSheet({ photos: [p], mode: 'plant', onApply: () => {} });
}, ids.photo);
await top().locator('input[type=search]').fill('Пион Сара Бернар');
await top().getByRole('button', { name: 'Создать растение «Пион Сара Бернар»' }).click();
const inputs = top().locator('form input[type=text]');
const [spv, cvv] = [await inputs.nth(0).inputValue(), await inputs.nth(1).inputValue()];
await shot('create-prefill');
await check(spv === 'Пион' && cvv === 'Сара Бернар', `поиск разложен на вид и сорт: «${spv}» / «${cvv}»`);

await check(!errors.length, `без ошибок в консоли ${errors.join('; ')}`);
await browser.close();
console.log('ВСЁ ОК');
