// Сквозной тест версии 0.5: обновление базы со старой версии, отпечатки фото, подсказки «Похоже на…»,
// проверка точности. Запуск: PW=… PHOTOS4=… node tests/e2e/assistant.mjs (сервер на :8080)
import { readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '/tmp/shots4';
mkdirSync(SHOTS, { recursive: true });
const files = readdirSync(process.env.PHOTOS4).map((f) => join(process.env.PHOTOS4, f));

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
let step = 0;
const shot = (name) => page.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, '0')}-${name}.png` });
const check = async (cond, msg) => {
  if (!cond) { await page.screenshot({ path: `${SHOTS}/FAIL.png` }); throw new Error(`ПРОВАЛ: ${msg}`); }
  console.log(`✓ ${msg}`);
};

// База старой версии (1) с данными — как у пользователя до обновления
await page.goto(`${BASE}README.md`);
await page.evaluate(() => new Promise((resolve, reject) => {
  const r = indexedDB.open('plant-diary', 1);
  r.onupgradeneeded = () => {
    const db = r.result;
    const ph = db.createObjectStore('photos', { keyPath: 'id' });
    ph.createIndex('takenAt', 'takenAt'); ph.createIndex('status', 'status');
    ph.createIndex('placeIds', 'placeIds', { multiEntry: true }); ph.createIndex('plantIds', 'plantIds', { multiEntry: true });
    db.createObjectStore('images');
    for (const s of ['species', 'cultivars', 'places', 'plants', 'entries']) db.createObjectStore(s, { keyPath: 'id' });
    db.createObjectStore('meta');
  };
  r.onsuccess = () => {
    const t = r.result.transaction('species', 'readwrite');
    t.objectStore('species').put({ id: 'old-1', name: 'Пион', latin: '', family: '', notes: '', createdAt: 1 });
    t.oncomplete = () => { r.result.close(); resolve(); };
  };
  r.onerror = () => reject(r.error);
}));
errors.length = 0; // служебная страница без значка вкладки даёт 404 — к приложению не относится
await page.goto(`${BASE}#/catalog`);
await page.getByRole('link', { name: /Пион/ }).waitFor();
const stores = await page.evaluate(async () => (await (await import('/js/data/db.js')).openDB()).objectStoreNames.contains('features'));
await check(stores, 'база обновилась до новой версии, прежние данные на месте');

// Импорт и разметка: по 6 фото трёх клумб, по 2 фото каждой оставляем для подсказок
await page.goto(`${BASE}#/more`);
await page.locator('input[type=file]').first().setInputFiles(files);
await page.getByText('Импорт завершён').waitFor({ timeout: 60000 });
await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const names = { flowers: 'Цветник', shrubs: 'Кусты у забора', pond: 'Пруд' };
  const fresh = await s.photosByStatus('new');
  for (const [k, name] of Object.entries(names)) {
    const p = await s.createPlace({ name });
    const ids = fresh.filter((ph) => ph.fileName.startsWith(`${k}_`) && Number(ph.fileName.match(/_(\d)/)[1]) < 6).map((ph) => ph.id);
    await s.tagPhotos(ids, { placeId: p.id });
  }
  await (await import('/js/data/similarity.js')).indexAll();
});

// Подсказки для каждого неразмеченного фото
const results = await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const sim = await import('/js/data/similarity.js');
  const out = [];
  for (const ph of await s.photosByStatus('new')) {
    const sug = await sim.suggest([ph], 'place');
    out.push({ file: ph.fileName, top: sug[0] ? s.catalog.places.get(sug[0].key).name : null, share: sug[0]?.share });
  }
  return out;
});
const expected = { flowers: 'Цветник', shrubs: 'Кусты у забора', pond: 'Пруд' };
const right = results.filter((r) => r.top === expected[r.file.split('_')[0]]);
console.log('  ', results.map((r) => `${r.file}→${r.top}(${(r.share || 0).toFixed(2)})`).join(', '));
await check(right.length === results.length, `подсказка верна для ${right.length} из ${results.length} фото`);

// В интерфейсе: «Похоже на» в панели отметки
await page.goto(`${BASE}#/queue`);
await page.getByRole('link', { name: 'Разобрать прогулку' }).first().click();
await page.locator('.tile').first().waitFor();
const firstFile = await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  return (await s.photosByStatus('new')).sort((a, b) => a.takenAt - b.takenAt)[0].fileName;
});
await page.getByRole('button', { name: 'Клумба или вид…' }).click();
await page.locator('.sugg').waitFor();
await page.waitForTimeout(200);
const firstSugg = await page.locator('.sugg .pick-title').first().textContent();
await shot('suggestions');
await check(firstSugg === expected[firstFile.split('_')[0]], `в панели первой подсказкой стоит «${firstSugg}» для ${firstFile}`);
await page.locator('.sugg .pick-row').first().click();
await page.getByRole('button', { name: /Отметить \d+ фото/ }).click();
await page.getByText(/Отмечено: \d+ фото/).waitFor();
await check(true, 'подсказку можно выбрать одним касанием и отметить');

// Связь «растение ↔ клумба»
const link = await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const sim = await import('/js/data/similarity.js');
  const place = (n) => [...s.catalog.places.values()].find((p) => p.name === n);
  const [flowers, pond] = [place('Цветник'), place('Пруд')];
  const sp1 = await s.createSpecies({ name: 'Роза' });
  const sp2 = await s.createSpecies({ name: 'Кувшинка' });
  const rose = await s.createPlant({ speciesId: sp1.id, placeId: flowers.id });
  const lily = await s.createPlant({ speciesId: sp2.id, placeId: pond.id });
  const tagged = await s.photosByStatus('tagged');
  await s.tagPhotos(tagged.filter((p) => p.fileName.startsWith('flowers_')).map((p) => p.id), { plantIds: [rose.id] });
  await s.tagPhotos(tagged.filter((p) => p.fileName.startsWith('pond_')).map((p) => p.id), { plantIds: [lily.id] });
  const fresh = await s.photosByStatus('new');
  const pondPhoto = fresh.find((p) => p.fileName.startsWith('pond_'));
  const free = (await sim.suggest([pondPhoto], 'plant')).map((r) => r.key);
  const inFlowers = (await sim.suggest([pondPhoto], 'plant', { ctxPlace: flowers.id })).map((r) => r.key);
  const withPlant = { ...fresh.find((p) => p.fileName.startsWith('shrubs_')), plantIds: [rose.id] };
  const bedSugg = await sim.suggest([withPlant], 'place');
  return {
    freeTop: free[0] === lily.id,
    onlyBed: inFlowers.length > 0 && inFlowers.every((k) => k === rose.id),
    bedFirst: bedSugg[0]?.key === flowers.id && bedSugg[0]?.reason === 'plant',
  };
});
await check(link.freeTop, 'без клумбы: фото пруда → «Кувшинка»');
await check(link.onlyBed, 'клумба «Цветник» выбрана: предлагаются только растения цветника');
await check(link.bedFirst, 'на фото отмечена «Роза» → первой подсказкой клумба «Цветник»');

// Проверка точности
await page.goto(`${BASE}#/more`);
await page.getByRole('button', { name: 'Проверить точность' }).click();
await page.locator('.acc-table').waitFor({ timeout: 60000 });
const placeRow = await page.locator('.acc-table tbody tr').first().textContent();
await shot('accuracy');
await check(/Клумба или вид\d+%\d+%\d+/.test(placeRow), `таблица точности: ${placeRow}`);
const bedRow = await page.locator('.acc-table tbody tr').nth(2).textContent();
await check(/Растение, когда клумба уже выбрана\d+%\d+%\d+/.test(bedRow), `строка «когда клумба выбрана»: ${bedRow}`);

await check(errors.length === 0, `нет ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log('ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
