// Сквозной тест ядра: импорт → разбор прогулок → каталог → просмотр.
// Запуск: PW=/путь/к/node_modules/playwright-core PHOTOS=/путь/к/тестовым/фото node tests/e2e/smoke.mjs
// Перед запуском поднимите сервер: python3 -m http.server 8080
import { readdirSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://localhost:8080/';
const PHOTOS = process.env.PHOTOS;
const SHOTS = process.env.SHOTS || '/tmp/shots';
mkdirSync(SHOTS, { recursive: true });

const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); });
walk(PHOTOS);

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

let step = 0;
const shot = async (name) => page.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, '0')}-${name}.png` });
const check = async (cond, msg) => {
  if (!cond) {
    await page.screenshot({ path: `${SHOTS}/FAIL.png` });
    throw new Error(`ПРОВАЛ: ${msg}`);
  }
  console.log(`✓ ${msg}`);
};

await page.goto(BASE);
await page.getByRole('heading', { name: 'Добавьте фото растений' }).waitFor();
await check(true, 'пустой экран разбора показан');
await shot('empty');

// Импорт
await page.locator('input[type=file]').first().setInputFiles(files);
await page.getByText('Импорт завершён').waitFor({ timeout: 60000 });
const report = await page.locator('#import-banner p').textContent();
console.log('  отчёт:', report);
await check(report.includes('добавлено 20'), 'добавлено 20 фото (19 с EXIF + 1 без даты)');
await check(report.includes('уже были 1'), 'дубль распознан');
await check(report.includes('без даты 1'), 'фото без даты отмечено');
await check(report.includes('пропущено не-фото 1'), 'текстовый файл пропущен');
await page.waitForTimeout(300);
await shot('queue');
const cards = await page.locator('.walk-card').count();
await check(cards === 4, `4 прогулки (получено ${cards})`);

// Прогулка 1: вся — клумбой, новая клумба с GPS
await page.getByRole('link', { name: 'Разобрать прогулку' }).first().click();
await page.getByRole('heading', { name: '14 апреля 2023' }).waitFor();
await check((await page.locator('.tile.on').count()) === 0, 'прогулка открылась без выбора');
await page.getByRole('button', { name: 'Выбрать все' }).click();
await check((await page.locator('.tile.on').count()) === 8, 'в прогулке 8 фото, «Выбрать все» выбирает все');
await shot('walk');
await page.getByRole('button', { name: 'Клумба или вид…' }).click();
await page.getByRole('button', { name: 'Новая зона или клумба' }).click();
await page.getByPlaceholder('Название, например «Клумба у крыльца»').fill('Клумба у крыльца');
await shot('create-bed');
await page.getByRole('button', { name: 'Создать и выбрать' }).click();
await shot('bed-picked');
await page.getByRole('button', { name: 'Отметить 8 фото' }).click();
await page.getByText('Отмечено: 8 фото').waitFor();
await page.getByRole('heading', { name: 'Прогулка разобрана' }).waitFor();
await check(true, 'прогулка разобрана, подсказка «Отменить» показана');

// Прогулка 2: GPS рядом → подсказка клумбы; 3 фото — растению
await page.goto(`${BASE}#/queue`);
await page.getByRole('link', { name: 'Разобрать прогулку' }).first().click();
await page.getByRole('heading', { name: '2 мая 2023' }).waitFor();
await check((await page.locator('.page-head p').textContent()).includes('ближе всего: Клумба у крыльца'), 'по GPS подсказана ближайшая клумба');
await page.getByRole('button', { name: 'Снять', exact: true }).click();
const tiles = page.locator('.tile');
for (const i of [0, 1, 2]) await tiles.nth(i).click();
await check((await page.locator('.tile.on').count()) === 3, 'выбрано 3 фото');
await page.getByRole('button', { name: 'Это растение…' }).click();
await page.getByRole('button', { name: 'Создать новое растение' }).click();
await page.getByPlaceholder('Например, Хоста').fill('Хоста');
await page.getByPlaceholder('Например, June (можно оставить пустым)').fill('June');
await check((await page.locator('.place-field').textContent()).includes('Клумба у крыльца'), 'место растения подставлено из недавних');
await shot('create-plant');
await page.getByRole('button', { name: 'Создать и выбрать' }).click();
await page.getByRole('button', { name: 'Отметить 3 фото' }).click();
await page.getByText('Отмечено: 3 фото').waitFor();
await check((await page.locator('.tile').count()) === 2, 'в прогулке осталось 2 фото');

// Отмена
await page.getByRole('button', { name: 'Отменить' }).click();
await page.waitForTimeout(500);
await check((await page.locator('.tile').count()) === 5, 'отмена вернула 3 фото');
for (const i of [0, 1, 2]) {
  if (!(await tiles.nth(i).getAttribute('class')).includes('on')) await tiles.nth(i).click();
}
await page.getByRole('button', { name: 'Это растение…' }).click();
await page.waitForTimeout(300); await shot('pick-existing-plant');
await page.getByRole('button', { name: /Хоста «June»/ }).first().click();
await page.getByRole('button', { name: /Отметить \d+ фото/ }).click();
await page.getByText(/Отмечено: \d+ фото/).waitFor();
await shot('walk-after-plant');

// Скрыть одно как «не растение»
await page.locator('.tile').first().click();
const selCount = await page.locator('.tile.on').count();
if (selCount !== 1) {
  await page.getByRole('button', { name: 'Снять', exact: true }).click();
  await page.locator('.tile').first().click();
}
await page.getByRole('button', { name: 'Не растение — удалить из приложения' }).click();
await page.getByText('Удалено из приложения: 1 фото').waitFor();
await check(true, 'фото «не растение» удалено из приложения');

// Дерево мест: зона → клумба внутри неё
await page.goto(`${BASE}#/queue`);
await page.getByRole('link', { name: 'Разобрать прогулку' }).last().click();
await page.getByRole('button', { name: 'Выбрать все' }).click();
await page.getByRole('button', { name: 'Клумба или вид…' }).click();
await page.getByRole('button', { name: 'Новая зона или клумба' }).click();
await page.getByPlaceholder('Название, например «Клумба у крыльца»').fill('Зона огорода');
await page.getByRole('button', { name: 'Создать и выбрать' }).click();
await page.getByRole('button', { name: /Открыть «Зона огорода»/ }).click();
await page.getByRole('button', { name: 'Новая клумба в «Зона огорода»' }).click();
await page.getByPlaceholder('Название, например «Клумба у крыльца»').fill('Грядка с клубникой');
await page.getByRole('button', { name: 'Создать и выбрать' }).click();
await page.waitForTimeout(200);
await shot('tree-picker');
await check(await page.locator('.pick-row.on').filter({ hasText: 'Грядка с клубникой' }).isVisible(), 'клумба создана внутри зоны и выбрана');
await page.locator('.crumb').click();
await page.getByPlaceholder('Найти клумбу или зону').fill('клубн');
await check((await page.locator('.place-browser .pick-row').count()) === 1, 'поиск по дереву находит клумбу');
await page.keyboard.press('Escape');

// Вид (ракурс) внутри зоны
await page.goto(`${BASE}#/queue`);
await page.getByRole('link', { name: 'Разобрать прогулку' }).last().click();
await page.locator('.tile').first().waitFor();
await page.getByRole('button', { name: 'Выбрать все' }).click();
await page.getByRole('button', { name: 'Клумба или вид…' }).click();
await page.getByRole('button', { name: /Открыть «Зона огорода»/ }).click();
await page.getByRole('button', { name: 'Новый вид в «Зона огорода»' }).click();
await page.getByPlaceholder('Например, «Вид на дом» или «Вид дорожки»').fill('Вид на теплицу');
await page.getByRole('button', { name: 'Создать и выбрать' }).click();
await page.waitForTimeout(200);
await shot('view-created');
await check(await page.locator('.pick-row.view.on').filter({ hasText: 'Вид на теплицу' }).isVisible(), 'вид создан внутри зоны и выбран');
await page.getByRole('button', { name: /Отметить \d+ фото/ }).click();
await page.getByText(/Отмечено: \d+ фото/).waitFor();

// Доразметка растений в клумбе: 8 фото клумбы ещё без растений
await page.goto(`${BASE}#/queue`);
await page.getByRole('heading', { name: 'Доразметить растения' }).waitFor();
await check((await page.locator('.card .list-row').first().textContent()).includes('Клумба у крыльца'), 'клумба с фото без растений показана в «Разборе»');
await shot('queue-needs');
await page.locator('.card .list-row').first().click();
await page.getByRole('heading', { name: 'Растения на фото' }).waitFor();
await check((await page.locator('.tile').count()) === 8, 'в доразметке 8 фото без растений');
await page.getByRole('button', { name: 'Снять', exact: true }).click();
await page.locator('.tile').nth(0).click();
await page.locator('.tile').nth(1).click();
await page.getByRole('button', { name: 'Отметить растения…' }).click();
await page.getByText('Растут в «Клумба у крыльца»').waitFor();
await check(true, 'в списке сначала растения этой клумбы');
await page.getByRole('button', { name: /Хоста «June»/ }).first().click();
await page.getByRole('button', { name: 'Отметить 2 фото' }).click();
await page.getByText('Растения отмечены на 2 фото').waitFor();
await page.waitForTimeout(300);
await check((await page.locator('.tile').count()) === 6, 'после отметки осталось 6 фото без растений');
// Вид вместо доразметки: фото уходит из списка «без растений»
await page.locator('.tile').first().click();
await page.getByRole('button', { name: 'Это вид… (растения не размечаю)' }).click();
await page.getByRole('button', { name: /Открыть «Зона огорода»/ }).click();
await page.getByRole('button', { name: /Вид на теплицу/ }).click();
await page.getByRole('button', { name: 'Отметить 1 фото' }).click();
await page.getByText('Отмечено видом: 1 фото').waitFor();
await page.waitForTimeout(300);
await check((await page.locator('.tile').count()) === 5, 'фото, отмеченное видом, ушло из доразметки: осталось 5');
await page.getByRole('button', { name: /Все фото/ }).click();
await page.waitForTimeout(300);
await check((await page.locator('.tile-plants').count()) === 5, 'во «Все фото» значки растений на 5 фото (2 новых + 3 отмеченных при разборе)');
await shot('tagplace');

// Растение из другой клумбы на фото этой клумбы → новый экземпляр здесь, клумба не прицепляется
await page.goto(`${BASE}#/queue`);
await page.getByRole('link', { name: 'Разобрать прогулку' }).last().click();
await page.getByRole('heading', { name: '6 июня 2024' }).waitFor();
await page.getByRole('button', { name: 'Выбрать все' }).click();
await page.getByRole('button', { name: 'Клумба или вид…' }).click();
await page.getByPlaceholder('Найти клумбу или зону').fill('клубн');
await page.getByRole('button', { name: /Грядка с клубникой/ }).click();
await page.getByRole('button', { name: /Отметить \d+ фото/ }).click();
await page.getByText(/Отмечено: \d+ фото/).waitFor();
await page.goto(`${BASE}#/queue`);
await page.locator('.card .list-row', { hasText: 'Грядка с клубникой' }).click();
await page.getByRole('heading', { name: 'Растения на фото' }).waitFor();
await page.locator('.tile').first().click();
await page.getByRole('button', { name: 'Отметить растения…' }).click();
await page.getByPlaceholder('Найти растение, сорт, вид').fill('хост');
await page.getByText('добавится в «Грядка с клубникой»').waitFor();
await shot('variety-to-new-bed');
await page.getByRole('button', { name: /Хоста «June»/ }).click();
await page.getByRole('button', { name: 'Отметить 1 фото' }).click();
await page.getByText('Растения отмечены на 1 фото').waitFor();
const placesOfPhoto = await page.evaluate(async () => {
  const s = await import('/js/data/store.js');
  const plants = [...s.catalog.plants.values()].filter((p) => s.varietyName(p) === 'Хоста «June»');
  const ph = (await s.photosByStatus('tagged')).find((p) => p.plantIds.some((id) => plants.find((x) => x.id === id && s.catalog.places.get(x.placeId).name === 'Грядка с клубникой')));
  return { instances: plants.map((p) => s.catalog.places.get(p.placeId).name).sort(), photoPlaces: ph.placeIds.map((id) => s.catalog.places.get(id).name) };
});
await check(placesOfPhoto.instances.join(',') === 'Грядка с клубникой,Клумба у крыльца', `создан второй экземпляр: ${placesOfPhoto.instances}`);
await check(placesOfPhoto.photoPlaces.join(',') === 'Грядка с клубникой', `у фото осталась только своя клумба: ${placesOfPhoto.photoPlaces}`);

// Каталог
await page.goto(`${BASE}#/catalog`);
await page.getByRole('link', { name: /Хоста/ }).first().click();
await page.getByRole('heading', { name: 'Хоста' }).waitFor();
await shot('species');
await check((await page.getByRole('link', { name: /Хоста «June»/ }).count()) === 2, 'в каталоге два экземпляра Хосты «June» в разных клумбах');
await shot('species-two-instances');
await page.getByRole('link', { name: /Хоста «June» Клумба у крыльца/ }).click();
await page.getByRole('heading', { name: 'Хоста «June»' }).waitFor();
const plantPhotos = await page.locator('.photo-grid .tile').count();
await check(plantPhotos === 5, `у растения 5 фото (получено ${plantPhotos})`);
await shot('plant');
await page.locator('.photo-grid .tile').first().click();
await page.locator('.viewer-img').waitFor();
await page.waitForTimeout(400);
await check(await page.locator('.viewer .chip.plant').first().isVisible(), 'в просмотре видна отметка растения');
await shot('viewer');
// «Отметить» из просмотра открывает панель разметки поверх фото
await page.locator('.viewer').getByRole('button', { name: 'Отметить' }).click();
await page.locator('.sheet').waitFor();
await page.waitForTimeout(300);
const onTop = await page.evaluate(() => {
  const r = document.querySelector('.sheet').getBoundingClientRect();
  return !!document.elementFromPoint(r.left + r.width / 2, r.top + 40)?.closest('.sheet');
});
await check(onTop, 'панель разметки из просмотра видна поверх фото');
await page.getByRole('button', { name: 'Клумба или вид' }).click();
await page.getByRole('button', { name: /Открыть «Зона огорода»/ }).click();
await page.getByRole('button', { name: /Вид на теплицу/ }).click();
await page.getByRole('button', { name: 'Отметить 1 фото' }).click();
await page.locator('.viewer .chip', { hasText: 'Вид на теплицу' }).waitFor();
await check(true, 'отметка из просмотра сохранилась и видна на фото');
await shot('viewer-tagged');
await page.keyboard.press('Escape');
await page.locator('.viewer').waitFor({ state: 'detached' });

await page.goto(`${BASE}#/catalog/places`);
await page.waitForTimeout(300);
await shot('places');
await page.getByRole('link', { name: /Клумба у крыльца/ }).click();
await page.getByRole('heading', { name: 'Клумба у крыльца' }).waitFor();
const placePhotos = await page.locator('.photo-grid .tile').count();
await check(placePhotos === 11, `у клумбы 11 фото: 8 + 3 через растение (получено ${placePhotos})`);
await shot('place');

// Ещё
await page.goto(`${BASE}#/more`);
await page.getByText('Скрыто («не растение»)').waitFor();
await check(await page.getByText(/Удалено из приложения: 1 фото/).isVisible(), 'в «Ещё» видно число удалённых');
await shot('more');

// Повторный импорт: удалённое фото не возвращается
await page.getByRole('button', { name: 'Скрыть' }).click();
await page.locator('input[type=file]').first().setInputFiles(files);
await page.getByText('Импорт завершён').waitFor({ timeout: 60000 });
const report2 = await page.locator('#import-banner p').textContent();
await check(report2.includes('добавлено 0') && report2.includes('удалены раньше 1'), `повторный импорт: ${report2}`);

// Сохранность после перезагрузки
await page.goto(`${BASE}#/queue`);
await page.reload();
await page.locator('.walk-card').first().waitFor();
const after = await page.locator('.progress-block p').first().textContent();
await check(after.includes('Осталось'), `после перезагрузки данные на месте: «${after.trim()}»`);
await shot('queue-after');

// Тёмная тема и ширина компьютера
await page.emulateMedia({ colorScheme: 'dark' });
await shot('queue-dark');
await page.setViewportSize({ width: 1280, height: 860 });
await page.goto(`${BASE}#/place/${await page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('plant-diary'); q.onsuccess = () => r(q.result); });
  return new Promise((r) => { const q = db.transaction('places').objectStore('places').getAll(); q.onsuccess = () => r(q.result[0].id); });
})}`);
await page.waitForTimeout(500);
await shot('desktop-place-dark');

await check(errors.length === 0, `нет ошибок в консоли${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log('ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
