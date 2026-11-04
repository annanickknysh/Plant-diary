// Сквозной тест 0.11: корзина — «не растение» не стирается сразу, его можно посмотреть, вернуть,
// разметить или удалить навсегда; удалённые раньше насовсем возвращаются из папки без лишнего.
// Запуск: PW=… PHOTOS2=… node tests/e2e/trash.mjs (сервер на :8080)
import { readdirSync } from 'node:fs';
const { chromium } = await import(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '/tmp/shots-trash';
const DIR = process.env.PHOTOS2;
const files = readdirSync(DIR).map((f) => `${DIR}/${f}`);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU' })).newPage();
page.setDefaultTimeout(15000);
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const check = async (cond, msg) => {
  if (!cond) { await page.screenshot({ path: `${SHOTS}-FAIL.png` }); throw new Error(`ПРОВАЛ: ${msg}`); }
  console.log(`✓ ${msg}`);
};
const banner = () => page.locator('#import-banner p').textContent();
await page.goto(BASE);
await page.locator('input[type=file]').first().setInputFiles(files);
await page.getByText('Импорт завершён').waitFor({ timeout: 60000 });
const total = await page.evaluate(async () => (await (await import('/js/data/store.js')).countPhotos()).total);

// В корзину 3 фото первой прогулки
await page.getByRole('link', { name: 'Разобрать прогулку' }).first().click();
for (let k = 0; k < 3 && k < await page.locator('.tile').count(); k++) await page.locator('.tile').nth(k).click();
const viaWalk = await page.locator('.tile.on').count();
await page.getByRole('button', { name: 'Не растение — в корзину' }).click();
await page.getByText(`В корзине: ${viaWalk} фото`).waitFor();
await check(true, `${viaWalk} фото — в корзину из прогулки`);
// И ещё три — для остальных проверок
await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  await s.trashPhotos((await s.photosByStatus('new')).slice(0, 3).map((p) => p.id));
});
const sent = viaWalk + 3;

await page.goto(`${BASE}#/more`);
await page.getByRole('link', { name: `Корзина (${sent})` }).click();
await page.getByRole('heading', { name: 'Корзина' }).waitFor();
await check(await page.locator('.tile').count() === sent, 'в корзине видны отправленные фото');
// Посмотреть крупно
await page.locator('.tile-zoom').first().click();
await page.locator('.viewer-img').waitFor();
await check((await page.locator('.viewer').textContent()).includes('В корзине'), 'в просмотре видно, что фото в корзине');
await page.keyboard.press('Escape');
await page.screenshot({ path: `${SHOTS}-list.png` });

// Отметить прямо из корзины
await page.locator('.tile').first().click();
await page.getByRole('button', { name: 'Отметить…' }).click();
await page.getByRole('button', { name: 'Новая зона или клумба' }).click();
await page.getByPlaceholder('Название, например «Клумба у крыльца»').fill('Найдено в корзине');
await page.getByRole('button', { name: 'Создать и выбрать' }).click();
await page.locator('.sheet-overlay').getByRole('button', { name: /^Отметить 1 фото/ }).click();
await page.getByText(/Размечено и возвращено из корзины: 1 фото/).waitFor();
const st1 = await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  return { tagged: (await s.photosByStatus('tagged')).length, hidden: (await s.photosByStatus('hidden')).length };
});
await check(st1.tagged === 1 && st1.hidden === sent - 1, `отмеченное вышло из корзины (размечено ${st1.tagged}, в корзине ${st1.hidden})`);

// Вернуть в разбор
await page.locator('.tile').first().click();
await page.getByRole('button', { name: /Вернуть в разбор \(1\)/ }).click();
await page.getByText('Вернулось в разбор: 1 фото').waitFor();

// Удалить навсегда последнее — а потом вернуть его из папки, не трогая остальное
const left = await page.locator('.tile').count();
await page.locator('.tile').first().click();
await page.getByRole('button', { name: 'Удалить навсегда' }).click();
await page.getByText('Удалено навсегда: 1 фото').waitFor();
await check(await page.locator('.tile').count() === left - 1, 'удалённое навсегда пропало из корзины');
await page.getByText(/Удалены насовсем раньше: 1 фото/).waitFor();
await check(true, 'в корзине — карточка «удалены насовсем раньше: 1»');
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Выбрать фото' }).click()]);
await chooser.setFiles(files);
await page.getByText('Импорт завершён').waitFor({ timeout: 60000 });
const rep = await banner();
await check(rep.includes('добавлено 1') && rep.includes('возвращено удалённых 1') && rep.includes(`пропущено (не удалялись) ${files.length - 1}`), `вернули только удалённое: ${rep}`);
const st2 = await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  return { total: (await s.countPhotos()).total, deleted: (await s.deletedIds()).size };
});
await check(st2.total === total && st2.deleted === 0, `все ${total} фото снова в приложении, список удалённых пуст`);
await check(!errors.length, `без ошибок ${errors.join('; ')}`);
await browser.close();
console.log('ВСЁ ОК');
