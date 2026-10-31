import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;

test('service worker кэширует все файлы приложения (иначе не откроется офлайн)', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]));
  const files = [];
  const walk = (d) => readdirSync(d).forEach((f) => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(root, p));
  });
  ['js', 'css', 'icons'].forEach((d) => walk(join(root, d)));
  const missing = files.filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `не перечислены в sw.js: ${missing.join(', ')}`);
  for (const f of listed) {
    if (f === '') continue;
    assert.ok(statSync(join(root, f)), `нет файла ${f}`);
  }
});
