// Сквозной тест 0.9.6: поворот фото в просмотре — новые картинки и пересчёт отпечатков (прежнего и нейросети).
// Запуск: PW=… DEMO=/путь/к/демо-фото node tests/e2e/rotate.mjs (сервер на :8080)
const { chromium } = await import(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '/tmp/shots-rotate';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU' })).newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const check = async (cond, msg) => {
  if (!cond) { await page.screenshot({ path: `${SHOTS}-FAIL.png` }); throw new Error(`ПРОВАЛ: ${msg}`); }
  console.log(`✓ ${msg}`);
};
await page.goto(BASE);
await page.locator('input[type=file]').first().setInputFiles([`${process.env.DEMO}/20240618_183000_peony.jpg`, `${process.env.DEMO}/20240618_184000_rose.jpg`]);
await page.getByText('Импорт завершён').waitFor({ timeout: 60000 });
// Включаем нейросеть и ждём отпечатки
await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  await s.setSetting('nnEnabled', true);
  const bed = await s.createPlace({ name: 'Пионы' });
  await s.tagPhotos((await s.photosByStatus('new')).map((p) => p.id), { placeId: bed.id });
  const nn = await import('/js/data/nnIndex.js');
  await nn.nnRun();
});
const snap = () => page.evaluate(async () => {
  const { getAll, get, STORES } = await import('/js/data/db.js');
  const p = (await getAll(STORES.photos)).find((x) => x.fileName.includes('peony'));
  const f = await get(STORES.features, p.id);
  const e = await get(STORES.embeddings, p.id);
  const t = await get(STORES.images, `${p.id}:t`);
  const bmp = await createImageBitmap(t);
  return { id: p.id, w: p.w, h: p.h, tw: bmp.width, th: bmp.height, f: f ? Array.from(f.f.slice(0, 40)) : null, e: e ? Array.from(e.e.slice(0, 40)) : null };
});
const before = await snap();
await check(before.f && before.e && before.w > before.h, `до поворота: ${before.w}×${before.h}, оба отпечатка есть`);

// Открываем фото в просмотре и поворачиваем по часовой
await page.evaluate(async (id) => {
  const { getAll, STORES } = await import('/js/data/db.js');
  const { openViewer } = await import('/js/views/viewer.js');
  const list = (await getAll(STORES.photos)).sort((a, b) => (a.id === id ? -1 : 1));
  openViewer(list, 0);
}, before.id);
await page.getByRole('button', { name: 'Повернуть по часовой стрелке' }).click();
await page.getByText('Фото повёрнуто').waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}-after.png` });
const after = await snap();
const diff = (a, b) => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0);
await check(after.w === before.h && after.h === before.w && after.tw === before.th, `после поворота: ${after.w}×${after.h}, превью ${after.tw}×${after.th}`);
await check(after.f && diff(after.f, before.f) > 0.05, 'прежний отпечаток пересчитан');
await check(after.e && diff(after.e, before.e) > 0.05, 'отпечаток нейросети пересчитан');
const shown = await page.locator('.viewer-img').evaluate((img) => img.decode().then(() => [img.naturalWidth, img.naturalHeight]));
await check(shown[1] > shown[0], `в просмотре показана повёрнутая картинка ${shown.join('×')}`);

// Обратно — отпечатки снова как до поворота (почти)
await page.getByRole('button', { name: 'Повернуть против часовой стрелки' }).click();
await page.waitForFunction(() => !document.querySelector('.viewer-actions button[disabled]'));
await page.waitForTimeout(800);
const back = await snap();
await check(back.w === before.w && diff(back.e, before.e) < diff(after.e, before.e), 'поворот обратно вернул кадр и отпечатки');
await check(!errors.length, `без ошибок ${errors.join('; ')}`);
await browser.close();
console.log('ВСЁ ОК');
