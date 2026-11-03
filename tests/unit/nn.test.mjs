import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModel, run, toInput } from '../../js/lib/nn.js';

const root = new URL('../../', import.meta.url);

test('нейросеть в приложении считает так же, как эталонная (onnxruntime)', () => {
  const spec = JSON.parse(readFileSync(new URL('vendor/mobilenetv2-1.json', root), 'utf8'));
  const w = readFileSync(new URL('vendor/mobilenetv2-1.f16', root));
  const model = loadModel(spec, w.buffer.slice(w.byteOffset, w.byteOffset + w.length));
  // Тот же узор, что и в эталоне
  const S = 224;
  const rgba = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    rgba[i] = (x * 7 + y * 13) % 256; rgba[i + 1] = (x * 3 + y * 5 + 80) % 256; rgba[i + 2] = (x * 11 + y * 2 + 160) % 256; rgba[i + 3] = 255;
  }
  const e = run(model, toInput(rgba, S, spec.mean, spec.std));
  const ref = JSON.parse(readFileSync(new URL('tests/fixtures/nn-reference.json', root), 'utf8'));
  assert.equal(e.length, 1280);
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < ref.length; i++) { dot += e[i] * ref[i]; na += e[i] ** 2; nb += ref[i] ** 2; }
  const cos = dot / Math.sqrt(na * nb);
  assert.ok(cos > 0.9995, `совпадение ${cos}`);
});
