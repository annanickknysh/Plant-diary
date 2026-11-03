// Обучаемая «голова» над нейросетью: гребневая регрессия (ridge) в двойственной форме.
// Учится отличать именно ваши клумбы и растения друг от друга по отпечаткам нейросети.
// Обучение — одно решение системы n×n (n — число размеченных фото), на 700 фото это секунды.

/**
 * @param X — массив отпечатков (Float32Array одинаковой длины, нормированные)
 * @param labels — для каждого фото список его меток (id клумб или растений)
 * @param opts.lambda — сила «сглаживания»: больше — осторожнее, меньше — точнее подгонка
 * @returns {{classes, A, X, counts}} или null, если учиться не на чем
 */
export function trainHead(X, labels, { lambda = 0.5 } = {}) {
  const idx = [];
  for (let i = 0; i < X.length; i++) if (labels[i]?.length) idx.push(i);
  const n = idx.length;
  if (n < 2) return null;
  const classes = [...new Set(idx.flatMap((i) => labels[i]))];
  const C = classes.length;
  const ci = new Map(classes.map((c, k) => [c, k]));
  const counts = new Array(C).fill(0);
  const Xs = idx.map((i) => X[i]);
  const d = Xs[0].length;

  // Матрица сходств K = X·Xᵀ + λI
  const K = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const a = Xs[i];
    for (let j = 0; j <= i; j++) {
      const b = Xs[j];
      let s = 0;
      for (let k = 0; k < d; k++) s += a[k] * b[k];
      K[i * n + j] = s;
      K[j * n + i] = s;
    }
    K[i * n + i] += lambda;
  }
  // Разложение Холецкого K = L·Lᵀ (на месте, в нижнем треугольнике)
  for (let j = 0; j < n; j++) {
    let s = K[j * n + j];
    for (let k = 0; k < j; k++) s -= K[j * n + k] * K[j * n + k];
    if (s <= 0) return null;
    const ljj = Math.sqrt(s);
    K[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let t = K[i * n + j];
      for (let k = 0; k < j; k++) t -= K[i * n + k] * K[j * n + k];
      K[i * n + j] = t / ljj;
    }
  }
  // Правая часть: метки фото (у фото может быть несколько)
  const A = new Float64Array(n * C);
  idx.forEach((i, r) => {
    for (const l of labels[i]) { A[r * C + ci.get(l)] = 1; counts[ci.get(l)]++; }
  });
  // Решаем L·Lᵀ·A = Y по столбцам
  const col = new Float64Array(n);
  for (let c = 0; c < C; c++) {
    for (let i = 0; i < n; i++) col[i] = A[i * C + c];
    for (let i = 0; i < n; i++) {
      let s = col[i];
      for (let k = 0; k < i; k++) s -= K[i * n + k] * col[k];
      col[i] = s / K[i * n + i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = col[i];
      for (let k = i + 1; k < n; k++) s -= K[k * n + i] * col[k];
      col[i] = s / K[i * n + i];
    }
    for (let i = 0; i < n; i++) A[i * C + c] = col[i];
  }
  return { classes, A, X: Xs, counts, C };
}

/**
 * Оценки всех классов для отпечатка q.
 * @param allow — если задано, Set классов, среди которых выбирать (например, растения клумбы)
 * @returns [{label, score, support}] по убыванию
 */
export function predictHead(head, q, { allow = null } = {}) {
  const { X, A, C, classes, counts } = head;
  const n = X.length;
  const d = q.length;
  const scores = new Float64Array(C);
  for (let i = 0; i < n; i++) {
    const x = X[i];
    let k = 0;
    for (let j = 0; j < d; j++) k += x[j] * q[j];
    const row = i * C;
    for (let c = 0; c < C; c++) scores[c] += k * A[row + c];
  }
  const out = [];
  for (let c = 0; c < C; c++) if (!allow || allow.has(classes[c])) out.push({ label: classes[c], score: scores[c], support: counts[c] });
  return out.sort((a, b) => b.score - a.score);
}

/** Оценки → доли для подсказок (как «уверенность» у прежнего способа). */
export function toShares(list, top = 5) {
  const head = list.slice(0, top);
  const pos = head.map((x) => Math.max(0, x.score));
  const sum = pos.reduce((s, x) => s + x, 0) || 1;
  return head.map((x, i) => ({ ...x, share: pos[i] / sum }));
}
