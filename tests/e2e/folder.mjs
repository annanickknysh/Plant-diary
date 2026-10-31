// Сквозной тест 0.6.2: импорт папки целиком с фильтром по периоду.
// Запуск: PW=… FOLDER=/путь/к/папке node tests/e2e/folder.mjs (сервер на :8080)
// В папке — фото testphotos2 (2024–2026), даты изменения файлов = даты съёмки.
const { chromium } = await import(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '/tmp/shots-folder';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const check = async (cond, msg) => {
  if (!cond) { await page.screenshot({ path: `${SHOTS}-FAIL.png` }); throw new Error(`ПРОВАЛ: ${msg}`); }
  console.log(`✓ ${msg}`);
};

await page.goto(BASE);
await page.getByRole('button', { name: 'Добавить папку' }).first().waitFor();
await check(true, 'кнопка «Добавить папку» есть и на телефоне');

// Первый раз: дневник пуст → по умолчанию «Всю папку»; выбираем 2025 год вручную
await page.locator('input[webkitdirectory]').first().setInputFiles(process.env.FOLDER);
await page.getByRole('heading', { name: 'Какие фото добавить' }).waitFor();
const sheet = page.locator('.sheet-overlay').last();
await check(await sheet.getByRole('button', { name: 'Всю папку' }).getAttribute('aria-pressed') === 'true', 'по умолчанию — вся папка');
await sheet.getByLabel('С').fill('2025-01-01');
await sheet.getByLabel('По').fill('2025-12-31');
await sheet.getByLabel('По').dispatchEvent('change');
const est = await sheet.locator('p.muted').first().textContent();
await check(est.startsWith('Примерно 7 фото из 15'), `оценка по датам файлов: ${est}`);
await page.screenshot({ path: `${SHOTS}-sheet.png` });
await sheet.getByRole('button', { name: 'Добавить фото за период' }).click();
await page.getByText('Импорт завершён').waitFor({ timeout: 60000 });
const banner = await page.locator('#import-banner').textContent();
await check(banner.includes('добавлено 7') && banner.includes('вне периода 8'), `добавлены только фото 2025 года: ${banner}`);
const years = await page.evaluate(async () => {
  const { getAll, STORES } = await import('/js/data/db.js');
  return [...new Set((await getAll(STORES.photos)).map((p) => new Date(p.takenAt).getFullYear()))];
});
await check(years.length === 1 && years[0] === 2025, 'в дневнике только 2025 год');

// Второй раз: по умолчанию «новее последнего фото» (2 окт 2025)
await page.locator('input[webkitdirectory]').first().setInputFiles(process.env.FOLDER);
await page.getByRole('heading', { name: 'Какие фото добавить' }).waitFor();
const pressed = await sheet.locator('.pill[aria-pressed=true]').textContent();
await check(pressed.startsWith('Новее 2 октября 2025') || pressed.includes('2025'), `по умолчанию — новее последнего фото: ${pressed}`);
await sheet.getByRole('button', { name: 'Добавить фото за период' }).click();
await page.waitForTimeout(500);
await page.getByText('Импорт завершён').waitFor({ timeout: 60000 });
const banner2 = await page.locator('#import-banner').textContent();
await check(banner2.includes('добавлено 5'), `добавлены 5 фото 2026 года, 2025-10-02 уже был: ${banner2}`);

await check(!errors.length, `без ошибок ${errors.join('; ')}`);
await browser.close();
console.log('ВСЁ ОК');
