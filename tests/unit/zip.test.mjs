import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZip, readZip, crc32 } from '../../js/lib/zip.js';

test('CRC32 совпадает с эталоном', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('Архив: запись и чтение, русские имена, Blob и строки', async () => {
  const img = new Blob([new Uint8Array([1, 2, 3, 250, 251, 252])]);
  const zip = await createZip([
    { name: 'data.json', data: JSON.stringify({ привет: 'мир' }) },
    { name: 'images/фото_t.jpg', data: img },
  ]);
  const files = await readZip(zip);
  assert.deepEqual([...files.keys()], ['data.json', 'images/фото_t.jpg']);
  assert.deepEqual(JSON.parse(await files.get('data.json').getText()), { привет: 'мир' });
  const back = new Uint8Array(await (await files.get('images/фото_t.jpg').getBlob()).arrayBuffer());
  assert.deepEqual([...back], [1, 2, 3, 250, 251, 252]);
});

test('Совместимость: наш архив читает Python, архив Python со сжатием читаем мы', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const ours = join(dir, 'ours.zip');
  writeFileSync(ours, Buffer.from(await (await createZip([{ name: 'a.txt', data: 'тест'.repeat(100) }])).arrayBuffer()));
  const check = execFileSync('python3', ['-c', `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(z.read('a.txt').decode()[:4])`, ours]).toString().trim();
  assert.equal(check, 'тест');

  const theirs = join(dir, 'theirs.zip');
  execFileSync('python3', ['-c', `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED); z.writestr('b.txt','сад '*500); z.close()`, theirs]);
  const files = await readZip(new Blob([readFileSync(theirs)]));
  assert.equal(await files.get('b.txt').getText(), 'сад '.repeat(500));
});

test('Не архив — понятная ошибка', async () => {
  await assert.rejects(readZip(new Blob(['просто текст'])), /не файл дневника/);
});
