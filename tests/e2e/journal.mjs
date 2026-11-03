// Сквозной тест версии 0.4: съёмка с отметкой, записи дневника, резервная копия и перенос
// на другое «устройство» (второй профиль браузера с пустым хранилищем).
// Запуск: PW=… PHOTOS2=… NEWPHOTO=…/new-bloom.jpg node tests/e2e/journal.mjs (сервер на :8080)
import { readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '/tmp/shots3';
const DL = `${SHOTS}/downloads`;
mkdirSync(DL, { recursive: true });
const files = readdirSync(process.env.PHOTOS2).map((f) => join(process.env.PHOTOS2, f));

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const errors = [];
const newDevice = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Europe/Moscow', acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  return page;
};
let step = 0;
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, '0')}-${name}.png` });
const check = async (page, cond, msg) => {
  if (!cond) { await page.screenshot({ path: `${SHOTS}/FAIL.png` }); throw new Error(`ПРОВАЛ: ${msg}`); }
  console.log(`✓ ${msg}`);
};
const dismissBanner = async (page) => { const b = page.getByRole('button', { name: 'Скрыть' }); if (await b.isVisible()) await b.click(); };

// ===== Устройство A: компьютер =====
const A = await newDevice('A');
await A.goto(BASE);
await A.locator('input[type=file]').first().setInputFiles(files);
await A.getByText('Импорт завершён').waitFor({ timeout: 60000 });
await dismissBanner(A);
const ids = await A.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const porch = await s.createPlace({ name: 'У крыльца' });
  const sp = await s.createSpecies({ name: 'Хоста' });
  const cv = await s.createCultivar({ speciesId: sp.id, name: 'June' });
  const a = await s.createPlant({ speciesId: sp.id, cultivarId: cv.id, placeId: porch.id });
  const fresh = await s.photosByStatus('new');
  await s.tagPhotos(fresh.filter((p) => p.fileName.startsWith('A_')).map((p) => p.id), { plantIds: [a.id] });
  return { plant: a.id, porch: porch.id };
});

// Быстрая запись с карточки растения
await A.goto(`${BASE}#/plant/${ids.plant}`);
await A.getByRole('button', { name: 'Зацвело сегодня' }).click();
await A.getByText('Цветение: запись на сегодня').waitFor();
await A.waitForTimeout(300);
await check(A, (await A.locator('.entry-type').first().textContent()) === 'Цветение', 'быстрая запись «Зацвело сегодня» появилась на карточке');

// Запись через форму
await A.getByRole('button', { name: 'Запись', exact: true }).click();
await A.locator('.sheet select').selectOption({ label: 'Подкормка' });
await A.locator('.sheet textarea').fill('Азофоска, половина дозы');
await A.getByRole('button', { name: 'Добавить запись' }).click();
await A.getByText('Запись добавлена').waitFor();
await A.waitForTimeout(300);
await check(A, (await A.locator('.entry').count()) === 2, 'две записи у растения');
await shot(A, 'plant-entries');

// Съёмка: выбрать растение и добавить снимок
await A.getByRole('link', { name: 'Снять' }).click();
await A.getByRole('heading', { name: 'Дневник' }).waitFor();
await check(A, (await A.locator('.target-row .list-title').textContent()).includes('Хоста «June»'), 'съёмка открылась для этого растения');
await A.locator('.card input[type=file]').nth(1).setInputFiles(process.env.NEWPHOTO);
await A.getByText('Импорт завершён').waitFor({ timeout: 30000 });
await A.waitForTimeout(500);
const tagged = await A.evaluate(async (pid) => (await (await import('/js/data/store.js')).photosOfPlant(pid)).length, ids.plant);
await check(A, tagged === 13, `новый снимок сразу отмечен растением (фото у растения: ${tagged})`);
await shot(A, 'journal');

// «Что снимаем»: три вкладки, как в каталоге
await A.getByRole('button', { name: 'Сменить' }).click();
await A.locator('.sheet-overlay .segmented button').first().waitFor();
const tabs = await A.locator('.sheet-overlay .segmented button').allTextContents();
await check(A, tabs.join(',') === 'Растение,Место,Вид', `вкладки: ${tabs.join(', ')}`);
await A.locator('.sheet-overlay .segmented').getByRole('button', { name: 'Вид', exact: true }).click();
await A.getByPlaceholder('Найти вид').fill('вид на дом');
await A.getByRole('button', { name: 'Создать вид «Вид на дом»' }).click();
await A.getByRole('button', { name: 'Создать и выбрать' }).click();
await shot(A, 'what-view');
await A.getByRole('button', { name: 'Выбрать', exact: true }).click();
await A.waitForTimeout(300);
await check(A, (await A.locator('.target-row .list-title').textContent()).includes('Вид на дом'), 'выбран новый вид');
await A.getByRole('button', { name: 'Сменить' }).click();
await A.locator('.sheet-overlay .segmented button').first().waitFor();
await check(A, (await A.locator('.sheet-overlay .segmented button[aria-pressed=true]').textContent()) === 'Вид', 'панель открылась на вкладке «Вид»');
await A.locator('.sheet-overlay .segmented').getByRole('button', { name: 'Место', exact: true }).click();
await A.waitForTimeout(200);
await check(A, (await A.locator('.sheet-overlay .place-browser').innerText()).includes('Вид на дом') === false, 'во вкладке «Место» видов нет');
await A.keyboard.press('Escape');

// Клумба → растения этой клумбы; сорт из другой клумбы — новым экземпляром здесь
await A.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const bed = await s.createPlace({ name: 'Розарий' });
  const sp = await s.createSpecies({ name: 'Роза' });
  await s.createPlant({ speciesId: sp.id, placeId: bed.id });
});
await A.getByRole('button', { name: 'Сменить' }).click();
await A.locator('.sheet-overlay .segmented button').first().waitFor();
await A.locator('.sheet-overlay .segmented').getByRole('button', { name: 'Место', exact: true }).click();
await A.locator('.sheet-overlay .pick-row', { hasText: 'Розарий' }).first().click();
await A.getByRole('button', { name: 'Растения «Розарий» →' }).click();
await A.waitForTimeout(200);
const plantTab = await A.locator('.sheet-overlay .tag-lists').innerText();
await shot(A, 'what-bed-plants');
await check(A, /Растут в «Розарий»[\s\S]*Роза/i.test(plantTab) && plantTab.includes('добавится в «Розарий»'), 'растения клумбы сверху, сорта из других клумб — «добавится»');
await A.locator('.sheet-overlay .pick-row', { hasText: 'Хоста «June»' }).first().click();
await A.getByRole('button', { name: 'Выбрать', exact: true }).click();
await A.waitForTimeout(500);
const tgt = await A.locator('.target-row .list-title').textContent();
await check(A, tgt.includes('Хоста «June» — Розарий'), `снимаем новый экземпляр в этой клумбе: ${tgt}`);

// Резервная копия: весь дневник
await A.goto(`${BASE}#/more`);
await dismissBanner(A);
await A.getByRole('button', { name: 'Сохранить весь дневник' }).click();
await A.getByRole('button', { name: 'Скачать' }).waitFor({ timeout: 60000 });
await shot(A, 'backup-ready');
const [dl1] = await Promise.all([A.waitForEvent('download'), A.getByRole('button', { name: 'Скачать' }).click()]);
const full = `${DL}/${dl1.suggestedFilename()}`;
await dl1.saveAs(full);
await check(A, /^plant-diary-\d{4}-\d\d-\d\d\.zip$/.test(dl1.suggestedFilename()), `файл копии: ${dl1.suggestedFilename()}`);

// ===== Устройство B: телефон, пустое хранилище =====
const B = await newDevice('B');
await B.goto(`${BASE}#/more`);
await B.getByRole('button', { name: 'Загрузить файл дневника' }).waitFor();
await B.locator('#backup input[type=file]').setInputFiles(full);
await B.getByText('Загружено.').waitFor({ timeout: 60000 });
const rep = await B.locator('.report').textContent();
await check(B, rep.includes('новых фото: 16'), `на телефон пришли все 16 фото: ${rep}`);
await shot(B, 'import-report');
await B.goto(`${BASE}#/plant/${ids.plant}`);
await B.getByRole('heading', { name: 'Хоста «June»' }).waitFor();
await check(B, (await B.locator('.entry').count()) === 2, 'записи дневника перенеслись');
await check(B, (await B.locator('.photo-grid .tile').count()) === 13, 'фото растения перенеслись с отметками');
await B.locator('.photo-grid .tile').first().click();
await B.locator('.viewer-img[src^="blob:"]').waitFor();
await check(B, true, 'перенесённое фото открывается во весь экран');
await B.keyboard.press('Escape');

// ===== Изменения на A → только изменения → B =====
await A.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const fresh = await s.photosByStatus('new');
  await s.deletePhotos([fresh[0].id]); // одно удалили
});
await A.goto(`${BASE}#/plant/${ids.plant}`);
await A.getByRole('button', { name: 'Запись', exact: true }).click();
await A.locator('.sheet select').selectOption({ label: 'Обрезка' });
await A.getByRole('button', { name: 'Добавить запись' }).click();
await A.getByText('Запись добавлена').waitFor();
await A.goto(`${BASE}#/more`);
await A.getByRole('button', { name: /Только изменения с/ }).click();
await A.getByRole('button', { name: 'Скачать' }).waitFor({ timeout: 60000 });
const [dl2] = await Promise.all([A.waitForEvent('download'), A.getByRole('button', { name: 'Скачать' }).click()]);
const changes = `${DL}/${dl2.suggestedFilename()}`;
await dl2.saveAs(changes);
await check(A, dl2.suggestedFilename().includes('changes'), `файл изменений: ${dl2.suggestedFilename()}`);

await B.goto(`${BASE}#/more`);
await B.locator('#backup input[type=file]').setInputFiles(changes);
await B.getByText('Загружено.').waitFor({ timeout: 60000 });
const rep2 = await B.locator('.report').textContent();
await check(B, rep2.includes('удалено, как на другом устройстве: фото 1'), `удаление перенеслось: ${rep2}`);
await B.goto(`${BASE}#/camera`);
await B.getByRole('heading', { name: 'Все записи' }).waitFor();
await check(B, (await B.locator('.entry').count()) === 3, 'новая запись пришла с изменениями');
await shot(B, 'journal-b');

// Повторная загрузка того же файла ничего не дублирует
await B.goto(`${BASE}#/more`);
await B.locator('#backup input[type=file]').setInputFiles(full);
await B.getByText('Загружено.').waitFor({ timeout: 60000 });
const rep3 = await B.locator('.report').textContent();
await check(B, rep3.includes('новых фото: 0'), `повторная загрузка без дублей: ${rep3}`);

await check(A, errors.length === 0, `нет ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log('ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
