// Сквозной тест 0.9: нейросеть — включение, фоновый пересчёт с продолжением после перезагрузки,
// подсказки и сравнение точности. Запуск: PW=… DEMO=/путь/к/демо-фото node tests/e2e/nn.mjs (сервер на :8080)
import { readdirSync } from 'node:fs';
const { chromium } = await import(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '/tmp/shots-nn';
const files = readdirSync(process.env.DEMO).map((f) => `${process.env.DEMO}/${f}`);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU' });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const check = async (cond, msg) => {
  if (!cond) { await page.screenshot({ path: `${SHOTS}-FAIL.png` }); throw new Error(`ПРОВАЛ: ${msg}`); }
  console.log(`✓ ${msg}`);
};
const nnDone = () => page.evaluate(async () => (await import('/js/data/nnIndex.js')).nnCount());
const waitCount = async (cond, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const n = await nnDone().catch(() => -1);
    if (cond(n)) return n;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`не дождались: ${await nnDone()}`);
};

await page.goto(BASE);
await page.locator('input[type=file]').first().setInputFiles(files);
await page.getByRole('button', { name: /^Добавить \d+ фото/ }).click();
await page.getByText('Импорт завершён').waitFor({ timeout: 90000 });
// Разметка: клумба по виду растения, растения — по имени файла; 2026-09-12 оставляем неразобранным
await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const beds = {};
  for (const n of ['Пионы', 'Розарий', 'Хосты', 'Гортензии']) beds[n] = await s.createPlace({ name: n });
  const view = await s.createPlace({ name: 'Вид на дом', kind: 'view' });
  const pl = {};
  for (const [k, sp, bed] of [['peony', 'Пион', 'Пионы'], ['rose', 'Роза', 'Розарий'], ['hosta', 'Хоста', 'Хосты'], ['hydrangea', 'Гортензия', 'Гортензии']]) {
    const x = await s.createSpecies({ name: sp });
    pl[k] = await s.createPlant({ speciesId: x.id, placeId: beds[bed].id });
  }
  for (const p of await s.photosByStatus('new')) {
    if (p.fileName.startsWith('20260912')) continue;
    const k = p.fileName.replace('.jpg', '').split('_')[2];
    await s.tagPhotos([p.id], k === 'view' ? { placeId: view.id } : { plantIds: [pl[k].id] });
  }
});

// Включаем нейросеть
await page.goto(`${BASE}#/more`);
await page.locator('#nn-on').check();
await page.getByText(/Изучаю фото: \d+ из 43/).waitFor({ timeout: 30000 });
const before = await waitCount((n) => n >= 10, 60000);
await page.screenshot({ path: `${SHOTS}-progress.png` });
await check(before >= 10 && before < 43, `в фоне изучено ${before} из 43 — перезагружаю приложение посреди работы`);
await page.reload();
await waitCount((n) => n > before, 60000);
await check(true, 'после перезагрузки работа продолжилась, прежние отпечатки на месте');
await waitCount((n) => n >= 43, 180000);
const ms = await page.evaluate(async () => Math.round((await import('/js/data/nnIndex.js')).nnState.msPerPhoto));
await check(true, `изучены все 43 фото; ${ms} мс на фото в Chrome`);

// Пауза и продолжение
await page.goto(`${BASE}#/more`);
await page.getByText(/Готово: нейросеть изучила 43 фото/).waitFor({ timeout: 20000 });
await check(true, 'карточка показывает «Готово»');

// Подсказки от нейросети: свежее фото гортензии 2026-09-12 → «Гортензии», растения «Гортензия»
const sugg = await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const sim = await import('/js/data/similarity.js');
  const out = [];
  for (const p of await s.photosByStatus('new')) {
    const place = await sim.suggest([p], 'place');
    const plant = await sim.suggest([p], 'plant');
    out.push({ file: p.fileName, place: s.catalog.places.get(place[0]?.key)?.name, plant: s.varietyName(s.catalog.plants.get(plant[0]?.key) || {}) });
  }
  return out;
});
console.log('  ', sugg.map((x) => `${x.file} → ${x.place} / ${x.plant}`).join('\n   '));
const right = sugg.filter((x) => {
  const k = x.file.replace('.jpg', '').split('_')[2];
  return k === 'view' ? x.place === 'Вид на дом' : ({ peony: 'Пион', rose: 'Роза', hosta: 'Хоста', hydrangea: 'Гортензия' })[k] === x.plant;
}).length;
await check(right >= 3, `подсказки нейросети для 4 свежих фото: верно ${right}`);

// Проверка точности: две колонки
await page.getByRole('button', { name: 'Проверить точность' }).click();
await page.locator('.acc-table.two').waitFor({ timeout: 120000 });
const rows = await page.locator('.acc-table.two tbody tr').allTextContents();
console.log('  ', rows.join('\n   '));
await page.locator('.acc-table.two').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}-accuracy.png` });
await check(rows.length === 3, 'таблица «Прежний / Нейросеть / Обученная»');
const heads = await page.locator('.acc-table.two thead th').allTextContents();
await check(heads.includes('Обученная'), `колонки: ${heads.filter(Boolean).join(', ')}`);
const best = await page.locator('.ok-note', { hasText: 'Подсказки теперь даёт' }).textContent();
await check(true, best);
// Подсказки от выбранной модели
const sugg2 = await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const sim = await import('/js/data/similarity.js');
  const out = [];
  for (const p of await s.photosByStatus('new')) out.push((await sim.suggest([p], 'place')).length);
  return { model: await s.getSetting('nnModel'), counts: out };
});
await check(sugg2.counts.every((n) => n > 0), `подсказки от модели «${sugg2.model}» есть для всех свежих фото`);
// «Голова»: первый вызов запускает обучение в фоне, затем подсказки идут от неё
const headRes = await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const sim = await import('/js/data/similarity.js');
  await s.setSetting('nnModel', 'head');
  const fresh = await s.photosByStatus('new');
  await sim.suggest([fresh[0]], 'place');
  const t = performance.now();
  await new Promise((r) => setTimeout(r, 2500));
  const out = [];
  for (const p of fresh) {
    const place = await sim.suggest([p], 'place');
    const plant = await sim.suggest([p], 'plant');
    out.push(`${p.fileName.split('_')[2]} → ${s.catalog.places.get(place[0]?.key)?.name} / ${s.varietyName(s.catalog.plants.get(plant[0]?.key) || {})}`);
  }
  return out;
});
console.log('   голова:', headRes.join('; '));
await check(headRes.filter((x) => /hydrangea.*Гортенз|peony.*Пион|rose.*Роз|view.*Вид на дом/.test(x)).length >= 3, 'подсказки обученной «головы» верны хотя бы для 3 из 4');
await check(!(await page.locator('.backup-status').last().innerText()).includes('null'), 'под таблицей нет лишнего «null»');

// Выключение — подсказки по-прежнему работают
await page.locator('#nn-on').uncheck();
await page.waitForTimeout(300);
const off = await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const sim = await import('/js/data/similarity.js');
  const [p] = await s.photosByStatus('new');
  return (await sim.suggest([p], 'place')).length;
});
await check(off > 0, 'с выключенной нейросетью подсказки работают по-прежнему');
await check(!errors.length, `без ошибок ${errors.join('; ')}`);
await browser.close();
console.log('ВСЁ ОК');
