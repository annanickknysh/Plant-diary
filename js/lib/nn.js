// Маленький движок для нейросети MobileNetV2: только то, что ей нужно — свёртки, ограничение 0…6,
// сложение и усреднение. Работает и в Web Worker, и в Node (для проверки с эталоном).

/** float16 → float32 */
function halfToFloat(h) {
  const s = (h & 0x8000) ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/**
 * @param spec — описание слоёв (mobilenetv2.json)
 * @param weights — ArrayBuffer с весами float16
 */
export function loadModel(spec, weights) {
  const u16 = new Uint16Array(weights);
  const table = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) table[i] = halfToFloat(i);
  const take = (off, n) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = table[u16[off + i]];
    return out;
  };
  const layers = spec.layers.map((l) => {
    if (l.op !== 'conv') return { ...l };
    const n = l.cout * l.cinPerGroup * l.k * l.k;
    const W = take(l.w, n);
    const out = { ...l, W, B: take(l.b, l.cout) };
    if (l.cinPerGroup === 1 && l.group === l.cout) {
      const kk = l.k * l.k;
      out.WT = new Float32Array(n);
      for (let c = 0; c < l.cout; c++) for (let t = 0; t < kk; t++) out.WT[t * l.cout + c] = W[c * kk + t];
    }
    return out;
  });
  // Сколько раз ещё понадобится каждый результат — чтобы освобождать память
  const uses = new Map();
  for (const l of layers) for (const name of [l.in, l.a, l.b].filter((x) => typeof x === 'string')) uses.set(name, (uses.get(name) || 0) + 1);
  // Свёртка, за которой сразу идёт ограничение 0…6, — делаем это ограничение прямо в свёртке
  for (let i = 0; i < layers.length - 1; i++) {
    const a = layers[i];
    const b = layers[i + 1];
    if (a.op === 'conv' && b.op === 'clip' && b.in === a.out && uses.get(a.out) === 1) {
      a.clip = [b.min, b.max];
      a.out = b.out;
      b.skip = true;
    }
  }
  return { spec, layers: layers.filter((l) => !l.skip), uses };
}

// Данные хранятся «пиксель за пикселем» (HWC): все каналы одного пикселя подряд.
// Так во внутренних циклах память читается подряд — заметно быстрее на телефоне.
function conv(x, C, H, Wd, l) {
  const { k, stride: s, pad, group, cout, cinPerGroup: cpg, W, B } = l;
  const Ho = Math.floor((H + 2 * pad - k) / s) + 1;
  const Wo = Math.floor((Wd + 2 * pad - k) / s) + 1;
  const HWo = Ho * Wo;
  const out = new Float32Array(cout * HWo);
  if (k === 1 && s === 1 && group === 1) {
    // Точечная свёртка 1×1: для каждого пикселя — 4 выходных канала за проход по входным
    for (let p = 0; p < HWo; p++) {
      const xi = p * C;
      const oi = p * cout;
      let co = 0;
      for (; co + 7 < cout; co += 8) {
        const r0 = co * C;
        let s0 = B[co]; let s1 = B[co + 1]; let s2 = B[co + 2]; let s3 = B[co + 3];
        let s4 = B[co + 4]; let s5 = B[co + 5]; let s6 = B[co + 6]; let s7 = B[co + 7];
        for (let ci = 0; ci < C; ci++) {
          const v = x[xi + ci];
          const w = r0 + ci;
          s0 += W[w] * v; s1 += W[w + C] * v; s2 += W[w + 2 * C] * v; s3 += W[w + 3 * C] * v;
          s4 += W[w + 4 * C] * v; s5 += W[w + 5 * C] * v; s6 += W[w + 6 * C] * v; s7 += W[w + 7 * C] * v;
        }
        out[oi + co] = s0; out[oi + co + 1] = s1; out[oi + co + 2] = s2; out[oi + co + 3] = s3;
        out[oi + co + 4] = s4; out[oi + co + 5] = s5; out[oi + co + 6] = s6; out[oi + co + 7] = s7;
      }
      for (; co < cout; co++) {
        let sum = B[co];
        const r = co * C;
        for (let ci = 0; ci < C; ci++) sum += W[r + ci] * x[xi + ci];
        out[oi + co] = sum;
      }
    }
  } else if (group === C && cpg === 1 && cout === C) {
    // Поканальная свёртка k×k: веса заранее переложены как [точка ядра][канал]
    const WT = l.WT;
    for (let oy = 0; oy < Ho; oy++) {
      for (let ox = 0; ox < Wo; ox++) {
        const oi = (oy * Wo + ox) * C;
        for (let c = 0; c < C; c++) out[oi + c] = B[c];
        for (let ky = 0; ky < k; ky++) {
          const iy = oy * s - pad + ky;
          if (iy < 0 || iy >= H) continue;
          for (let kx = 0; kx < k; kx++) {
            const ix = ox * s - pad + kx;
            if (ix < 0 || ix >= Wd) continue;
            const xi = (iy * Wd + ix) * C;
            const wi = (ky * k + kx) * C;
            for (let c = 0; c < C; c++) out[oi + c] += WT[wi + c] * x[xi + c];
          }
        }
      }
    }
  } else {
    // Обычная свёртка (первый слой: 3 канала, 3×3, шаг 2)
    const coutPerGroup = cout / group;
    for (let oy = 0; oy < Ho; oy++) {
      for (let ox = 0; ox < Wo; ox++) {
        const oi = (oy * Wo + ox) * cout;
        for (let co = 0; co < cout; co++) {
          const g = Math.floor(co / coutPerGroup);
          let sum = B[co];
          for (let ky = 0; ky < k; ky++) {
            const iy = oy * s - pad + ky;
            if (iy < 0 || iy >= H) continue;
            for (let kx = 0; kx < k; kx++) {
              const ix = ox * s - pad + kx;
              if (ix < 0 || ix >= Wd) continue;
              const xi = (iy * Wd + ix) * C + g * cpg;
              const wi = co * cpg * k * k + ky * k + kx;
              for (let ci = 0; ci < cpg; ci++) sum += W[wi + ci * k * k] * x[xi + ci];
            }
          }
          out[oi + co] = sum;
        }
      }
    }
  }
  if (l.clip) {
    const [lo, hi] = l.clip;
    for (let i = 0; i < out.length; i++) { const v = out[i]; out[i] = v < lo ? lo : v > hi ? hi : v; }
  }
  return { data: out, C: cout, H: Ho, W: Wo };
}

/**
 * Прогнать картинку через сеть.
 * @param input — Float32Array size×size×3 (пиксель за пикселем, уже нормированный)
 * @returns Float32Array — отпечаток (1280 чисел)
 */
export function run(model, input) {
  const { spec, layers } = model;
  const left = new Map(model.uses);
  const t = new Map([[spec.input, { data: input, C: 3, H: spec.size, W: spec.size }]]);
  const release = (name) => {
    const n = (left.get(name) || 0) - 1;
    left.set(name, n);
    if (n <= 0 && name !== spec.output) t.delete(name);
  };
  for (const l of layers) {
    if (l.op === 'conv') {
      const x = t.get(l.in);
      t.set(l.out, conv(x.data, x.C, x.H, x.W, l));
      release(l.in);
    } else if (l.op === 'clip') {
      const x = t.get(l.in);
      const d = new Float32Array(x.data.length);
      for (let i = 0; i < d.length; i++) { const v = x.data[i]; d[i] = v < l.min ? l.min : v > l.max ? l.max : v; }
      t.set(l.out, { ...x, data: d });
      release(l.in);
    } else if (l.op === 'add') {
      const a = t.get(l.a);
      const b = t.get(l.b);
      const d = new Float32Array(a.data.length);
      for (let i = 0; i < d.length; i++) d[i] = a.data[i] + b.data[i];
      t.set(l.out, { ...a, data: d });
      release(l.a);
      release(l.b);
    } else if (l.op === 'gap') {
      const x = t.get(l.in);
      const HW = x.H * x.W;
      const d = new Float32Array(x.C);
      for (let p = 0; p < HW; p++) for (let c = 0; c < x.C; c++) d[c] += x.data[p * x.C + c];
      for (let c = 0; c < x.C; c++) d[c] /= HW;
      return d;
    }
  }
  throw new Error('В модели нет усреднения на выходе');
}

/**
 * Пиксели RGBA size×size → вход сети (пиксель за пикселем: R, G, B).
 * @param rgba — Uint8ClampedArray
 */
export function toInput(rgba, size, mean, std) {
  const n = size * size;
  const x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) x[i * 3 + c] = (rgba[i * 4 + c] / 255 - mean[c]) / std[c];
  }
  return x;
}
