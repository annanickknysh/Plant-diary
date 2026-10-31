// «Отпечаток» фото для поиска похожих: без нейросетей, считается за миллисекунды на телефоне.
// Три части: какие цвета есть в кадре, как они расположены, какая текстура (направления линий).

export const FEATURE_VERSION = 1;
export const FEATURE_SIZE = 64; // фото уменьшается до 64×64 перед расчётом

const HUE_BINS = 12;
const GRAY_BINS = 4;
const GRID = 4; // расположение цветов: сетка 4×4
const ORI_BINS = 8;
const ORI_GRID = 2; // текстура: сетка 2×2
const WEIGHTS = { colors: 1, layout: 0.8, texture: 1 };

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max ? d / max : 0, max / 255];
}

function l2normalize(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= s;
  return v;
}

/** Корень из нормированной гистограммы (расстояние Хеллингера работает лучше для гистограмм). */
function sqrtHist(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i];
  s = s || 1;
  for (let i = 0; i < v.length; i++) v[i] = Math.sqrt(v[i] / s);
  return v;
}

/**
 * @param {Uint8ClampedArray} rgba — пиксели size×size
 * @param {number} size
 * @returns {Float32Array} единичной длины; похожесть двух фото — скалярное произведение
 */
export function computeFeatures(rgba, size = FEATURE_SIZE) {
  const n = size * size;
  // 1. Цвета: 12 оттенков × 2 насыщенности + 4 уровня серого
  const colors = new Float32Array(HUE_BINS * 2 + GRAY_BINS);
  // 2. Расположение: средние яркость и два цветовых канала в клетках 4×4
  const layout = new Float32Array(GRID * GRID * 3);
  const cellCount = new Float32Array(GRID * GRID);
  const gray = new Float32Array(n);
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const [hh, s, v] = rgbToHsv(r, g, b);
    if (s < 0.2 || v < 0.15) colors[HUE_BINS * 2 + Math.min(GRAY_BINS - 1, Math.floor(v * GRAY_BINS))]++;
    else colors[Math.min(HUE_BINS - 1, Math.floor(hh * HUE_BINS)) * 2 + (s < 0.5 ? 0 : 1)]++;
    const x = i % size;
    const y = Math.floor(i / size);
    const c = Math.floor((y * GRID) / size) * GRID + Math.floor((x * GRID) / size);
    const I = (r + g + b) / 765;
    const RG = (r - g) / 255;
    const YB = ((r + g) / 2 - b) / 255;
    layout[c * 3] += I;
    layout[c * 3 + 1] += RG;
    layout[c * 3 + 2] += YB;
    cellCount[c]++;
    mean[0] += I; mean[1] += RG; mean[2] += YB;
    gray[i] = I;
  }
  mean[0] /= n; mean[1] /= n; mean[2] /= n;
  for (let c = 0; c < GRID * GRID; c++) {
    for (let k = 0; k < 3; k++) layout[c * 3 + k] = layout[c * 3 + k] / (cellCount[c] || 1) - mean[k];
  }

  // 3. Текстура: направления перепадов яркости (Собель), 8 направлений в клетках 2×2
  const texture = new Float32Array(ORI_GRID * ORI_GRID * ORI_BINS);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const p = (yy, xx) => gray[yy * size + xx];
      const gx = p(y - 1, x + 1) + 2 * p(y, x + 1) + p(y + 1, x + 1) - p(y - 1, x - 1) - 2 * p(y, x - 1) - p(y + 1, x - 1);
      const gy = p(y + 1, x - 1) + 2 * p(y + 1, x) + p(y + 1, x + 1) - p(y - 1, x - 1) - 2 * p(y - 1, x) - p(y - 1, x + 1);
      const mag = Math.hypot(gx, gy);
      if (mag < 0.02) continue;
      let a = Math.atan2(gy, gx);
      if (a < 0) a += Math.PI;
      const bin = Math.min(ORI_BINS - 1, Math.floor((a / Math.PI) * ORI_BINS));
      const cell = Math.floor((y * ORI_GRID) / size) * ORI_GRID + Math.floor((x * ORI_GRID) / size);
      texture[cell * ORI_BINS + bin] += mag;
    }
  }
  for (let c = 0; c < ORI_GRID * ORI_GRID; c++) sqrtHist(texture.subarray(c * ORI_BINS, (c + 1) * ORI_BINS));

  const parts = [
    [l2normalize(sqrtHist(colors)), WEIGHTS.colors],
    [l2normalize(layout), WEIGHTS.layout],
    [l2normalize(texture), WEIGHTS.texture],
  ];
  const out = new Float32Array(parts.reduce((s, [v]) => s + v.length, 0));
  let o = 0;
  for (const [v, w] of parts) {
    for (let i = 0; i < v.length; i++) out[o++] = v[i] * w;
  }
  return l2normalize(out);
}

export function similarity(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Голосование ближайших соседей.
 * @param query — отпечаток (или средний отпечаток нескольких фото)
 * @param labeled — [{f, labels: string[], takenAt}]
 * @param opts.k — сколько ближайших фото учитывать
 * @param opts.month — месяц запроса (0–11): снимки того же времени года весят чуть больше
 * @returns [{label, score, support}] по убыванию score
 */
export function vote(query, labeled, { k = 15, month = null } = {}) {
  const scored = [];
  for (const item of labeled) {
    let s = similarity(query, item.f);
    if (month !== null && item.takenAt) {
      const m = new Date(item.takenAt).getMonth();
      const dm = Math.min(Math.abs(m - month), 12 - Math.abs(m - month));
      s += 0.03 * (1 - dm / 6); // до +0.03 за тот же месяц
    }
    scored.push({ s, labels: item.labels });
  }
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, k);
  const acc = new Map();
  top.forEach((t, rank) => {
    const w = Math.max(0, t.s) ** 4 * (1 / (1 + rank * 0.15)); // ближние соседи весят заметно больше
    for (const l of t.labels) {
      const cur = acc.get(l) || { label: l, score: 0, support: 0, best: 0 };
      cur.score += w;
      cur.support++;
      cur.best = Math.max(cur.best, t.s);
      acc.set(l, cur);
    }
  });
  const total = [...acc.values()].reduce((s, x) => s + x.score, 0) || 1;
  return [...acc.values()].map((x) => ({ ...x, share: x.score / total })).sort((a, b) => b.score - a.score);
}

/** Средний отпечаток нескольких фото. */
export function meanFeature(list) {
  const out = new Float32Array(list[0].length);
  for (const f of list) for (let i = 0; i < f.length; i++) out[i] += f[i];
  return l2normalize(out);
}
