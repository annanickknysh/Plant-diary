// Сквозной тест 0.10: отметки «где интереснее» в «Сезонах» и экран «Избранные пары».
// Запуск: PW=… PHOTOS2=… node tests/e2e/favorites.mjs (сервер на :8080)
import { readdirSync } from 'node:fs';
const { chromium } = await import(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '/tmp/shots-fav';
const files = readdirSync(process.env.PHOTOS2).map((f) => `${process.env.PHOTOS2}/${f}`);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU' })).newPage();
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
await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const porch = await s.createPlace({ name: 'У крыльца' });
  const fence = await s.createPlace({ name: 'У забора' });
  const fresh = await s.photosByStatus('new');
  const A = fresh.filter((p) => p.fileName.startsWith('A_'));
  await s.tagPhotos(A.map((p) => p.id), { placeId: porch.id });
  await s.tagPhotos(fresh.filter((p) => p.fileName.startsWith('B_')).map((p) => p.id), { placeId: fence.id });
  // 👍 паре «май 2024 — май 2026» у крыльца
  const a = A.find((p) => p.fileName.includes('2024-05'));
  const b = A.find((p) => p.fileName.includes('2026-05'));
  await (await import('/js/data/viewFeedback.js')).setVote(a.id, b.id, true, null);
});

await page.goto(`${BASE}#/seasons`);
await page.locator('.list-row', { hasText: 'У крыльца' }).first().waitFor();
const porchRich = await page.locator('.list-row', { hasText: 'У крыльца' }).locator('.rich').textContent();
const fenceRich = await page.locator('.list-row', { hasText: 'У забора' }).locator('.rich').textContent();
await check(porchRich.startsWith('★1 · 3 года'), `у крыльца: ${porchRich}`);
await check(fenceRich === '2 года · весна ×2', `у забора: ${fenceRich}`);
await page.getByRole('button', { name: '★ где интереснее' }).click();
const first = await page.locator('#view .list .list-row .list-title').first().textContent();
await check(first === 'У крыльца', 'сортировка «где интереснее»: у крыльца первой');
await page.screenshot({ path: `${SHOTS}-home.png` });
await check((await page.locator('.fav-link').textContent()).includes('1 пара отмечена'), 'на главной «Сезонов» — «1 пара отмечена 👍»');

await page.locator('.fav-link').click();
await page.getByRole('heading', { name: 'Избранные пары' }).waitFor();
await page.locator('.fav-pair').first().waitFor();
await check((await page.locator('.fav-group .section-title').allTextContents()).join() === 'У крыльца', 'пара сгруппирована по месту');
await check((await page.locator('.fav-meta').textContent()) === 'разница 2 года', 'подпись: разница 2 года');
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}-list.png` });
await page.locator('.fav-pair').first().click();
await page.locator('.compare-body img').first().waitFor();
await check((await page.locator('.cmp-vote').textContent()).includes('закреплена'), 'в сравнении пара отмечена 👍');
await page.locator('.cmp-vote').getByRole('button', { name: 'Хорошая пара' }).click();
await page.waitForTimeout(300);
await page.locator('.compare').getByRole('button', { name: 'Закрыть' }).click();
await page.waitForTimeout(500);
await check(await page.locator('.fav-pair').count() === 0, 'снятая 👍 убирает пару из избранного');
await check(!errors.length, `без ошибок ${errors.join('; ')}`);
await browser.close();
console.log('ВСЁ ОК');
