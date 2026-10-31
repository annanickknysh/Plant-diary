import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseExif, parseExifContainer, dateFromFileName } from '../../js/lib/exif.js';

const PHOTOS = process.env.PHOTOS2 || '/home/claude/testphotos2';

test('EXIF внутри HEIC-контейнера находится по блоку «Exif\\0\\0»', (t) => {
  let jpg;
  try { jpg = readFileSync(`${PHOTOS}/${readdirSync(PHOTOS)[0]}`); } catch { t.skip('нет тестовых фото'); return; }
  const fromJpeg = parseExif(jpg.buffer.slice(jpg.byteOffset, jpg.byteOffset + jpg.length));
  assert.ok(fromJpeg.takenAt, 'в тестовом JPEG есть дата');
  // Достаём TIFF из APP1 и кладём его в «контейнер», как в HEIC: [мусор][offset][Exif\0\0][TIFF][мусор]
  const i = jpg.indexOf(Buffer.from('Exif\0\0'));
  const len = jpg.readUInt16BE(i - 2);
  const tiff = jpg.subarray(i + 6, i - 2 + len);
  const box = Buffer.concat([Buffer.from('\0\0\0\x18ftypheic\0\0\0\0mif1heic'), Buffer.alloc(3000, 7), Buffer.from([0, 0, 0, 6]), Buffer.from('Exif\0\0'), tiff, Buffer.alloc(5000, 1)]);
  const r = parseExifContainer(box.buffer.slice(box.byteOffset, box.byteOffset + box.length));
  assert.equal(r.takenAt, fromJpeg.takenAt);
  assert.equal(r.lat, fromJpeg.lat);
});

test('без EXIF — пусто, без ошибок', () => {
  const r = parseExifContainer(new Uint8Array(1000).buffer);
  assert.equal(r.takenAt, null);
});

test('дата из имени файла', () => {
  assert.equal(dateFromFileName('20240331_125733_IMG_6172.HEIC'), new Date(2024, 2, 31, 12, 57, 33).getTime());
  assert.equal(dateFromFileName('IMG_20230614_090105.jpg'), new Date(2023, 5, 14, 9, 1, 5).getTime());
  assert.equal(dateFromFileName('2022-08-01 18.30.12.jpg'), new Date(2022, 7, 1, 18, 30, 12).getTime());
  assert.equal(dateFromFileName('IMG_6172.HEIC'), null);
  assert.equal(dateFromFileName('20241399_999999.jpg'), null);
});
