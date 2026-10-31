// Сквозной тест 0.7: фото HEIC (айфон) раскрываются декодером libheif, дата — из EXIF или имени файла.
// Запуск: PW=… HEIC=/путь/к/файлу.HEIC node tests/e2e/heic.mjs (сервер на :8080)
const { chromium } = await import(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://localhost:8080/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU' });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const check = async (cond, msg) => {
  if (!cond) { await page.screenshot({ path: '/tmp/heic-FAIL.png' }); throw new Error(`ПРОВАЛ: ${msg}`); }
  console.log(`✓ ${msg}`);
};

await page.goto(BASE);
const native = await page.evaluate(async () => {
  try { await createImageBitmap(new Blob([new Uint8Array(16)], { type: 'image/heic' })); return true; } catch { return false; }
});
await check(!native, 'браузер сам HEIC не открывает — проверяем запасной путь');
const t0 = Date.now();
await page.locator('input[type=file]').first().setInputFiles(process.env.HEIC);
await page.getByText('Импорт завершён').waitFor({ timeout: 60000 });
const banner = await page.locator('#import-banner').textContent();
await check(banner.includes('добавлено 1') && !banner.includes('не прочитано'), `HEIC добавлен за ${Date.now() - t0} мс: ${banner}`);
const p = await page.evaluate(async () => {
  const { getAll, STORES } = await import('/js/data/db.js');
  const [ph] = await getAll(STORES.photos);
  return { takenAt: ph.takenAt, approx: ph.dateApprox, w: ph.w, h: ph.h };
});
await check(p.takenAt === new Date(2024, 2, 31, 12, 57, 33).getTime() && !p.approx, 'дата съёмки взята из имени файла');
await check(p.w > 500 && p.h > 300, `картинка раскрыта: ${p.w}×${p.h}`);
await page.goto(`${BASE}#/queue`);
await page.locator('img').first().waitFor();
const ok = await page.locator('img').first().evaluate((img) => img.decode().then(() => img.naturalWidth > 0, () => false));
await check(ok, 'превью показывается');
await page.screenshot({ path: '/tmp/heic-queue.png' });
await check(!errors.length, `без ошибок ${errors.join('; ')}`);
await browser.close();
console.log('ВСЁ ОК');
