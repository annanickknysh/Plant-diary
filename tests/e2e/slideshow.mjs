// Сквозной тест 0.8: слайд-шоу растения — все фото, один год, сезон по годам с разделителями, скорость.
// Запуск: PW=… DEMO=/путь/к/демо-фото node tests/e2e/slideshow.mjs (сервер на :8080)
import { readdirSync } from 'node:fs';
const { chromium } = await import(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '/tmp/shots-ss';
const files = readdirSync(process.env.DEMO).filter((f) => f.includes('peony')).map((f) => `${process.env.DEMO}/${f}`);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, locale: 'ru-RU', hasTouch: true });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const check = async (cond, msg) => {
  if (!cond) { await page.screenshot({ path: `${SHOTS}-FAIL.png` }); throw new Error(`ПРОВАЛ: ${msg}`); }
  console.log(`✓ ${msg}`);
};

await page.goto(BASE);
await page.locator('input[type=file]').first().setInputFiles(files);
await page.getByText('Импорт завершён').waitFor({ timeout: 60000 });
const plantId = await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const bed = await s.createPlace({ name: 'Клумба у крыльца' });
  const sp = await s.createSpecies({ name: 'Пион' });
  const p = await s.createPlant({ speciesId: sp.id, placeId: bed.id });
  await s.tagPhotos((await s.photosByStatus('new')).map((x) => x.id), { plantIds: [p.id] });
  return p.id;
});
await page.goto(`${BASE}#/plant/${plantId}`);
await page.getByRole('button', { name: 'Слайд-шоу' }).click();
const sheet = page.locator('.sheet-overlay').last();
await sheet.getByRole('heading', { name: 'Слайд-шоу' }).waitFor();
await check(/Смотреть · 12 фото/.test(await sheet.locator('.btn.primary').textContent()), 'все фото: 12');
await sheet.getByRole('button', { name: 'Один год' }).click();
await sheet.getByRole('button', { name: '2025', exact: true }).click();
await check(/Смотреть · 4 фото/.test(await sheet.locator('.btn.primary').textContent()), 'один год (2025): 4 фото');
await sheet.getByRole('button', { name: 'Сезон по годам' }).click();
await sheet.getByRole('button', { name: 'Лето', exact: true }).click();
await sheet.getByRole('button', { name: '2 сек' }).click();
await check(/Смотреть · 6 фото/.test(await sheet.locator('.btn.primary').textContent()), 'лето по годам: 6 фото');
await check(!(await sheet.locator('.slideshow-setup').innerText()).includes('null'), 'в настройках нет лишнего текста');
await page.screenshot({ path: `${SHOTS}-setup.png` });
await sheet.locator('.btn.primary').click();

await page.locator('.ss-layer.on .ss-divider').waitFor();
await check((await page.locator('.ss-layer.on .ss-divider strong').textContent()) === 'Лето 2024', 'первый кадр — разделитель «Лето 2024»');
await page.screenshot({ path: `${SHOTS}-divider.png` });
await page.locator('.ss-layer.on img').waitFor({ timeout: 5000 });
const cap = await page.locator('.ss-caption').textContent();
await check(/июня 2024 · Лето 2024/.test(cap), `после разделителя — фото с подписью: ${cap}`);
await page.waitForTimeout(700);
await page.screenshot({ path: `${SHOTS}-photo.png` });
// Пауза касанием
await page.locator('.ss-stage').click();
const before = await page.locator('.ss-caption').textContent();
await page.waitForTimeout(2600);
await check((await page.locator('.ss-caption').textContent()) === before, 'касание ставит на паузу');
// Листание вперёд до разделителя следующего года
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
const dividers = await page.locator('.ss-layer.on .ss-divider strong').allTextContents();
await check(dividers[0] === 'Лето 2025', `при смене года — разделитель: ${dividers.join()}`);
await page.getByRole('button', { name: 'Закрыть' }).click();
await check(await page.locator('.slideshow').count() === 0, 'показ закрывается');
await check(!errors.length, `без ошибок ${errors.join('; ')}`);
await browser.close();
console.log('ВСЁ ОК');
