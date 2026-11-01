// Оценки пар «похожий ракурс» (👍/👎): запоминаются и подстраивают подбор.
import { STORES, get, put } from './db.js';
import { fitViewWeights, DEFAULT_VIEW_WEIGHTS } from '../lib/features.js';

const KEY = 'viewFeedback';
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** [{k, good, parts:{lum,tex,full}, at}] */
export async function loadVotes() {
  return (await get(STORES.meta, KEY)) || [];
}

/** good: true (👍), false (👎) или null — снять оценку. */
export async function setVote(a, b, good, parts) {
  const k = pairKey(a, b);
  const list = (await loadVotes()).filter((v) => v.k !== k);
  if (good !== null) list.push({ k, good, parts, at: Date.now() });
  await put(STORES.meta, list.slice(-1000), KEY);
  return list;
}

/** Что учесть при подборе: понравившиеся, отвергнутые, веса. */
export function feedbackState(votes) {
  return {
    liked: new Set(votes.filter((v) => v.good).map((v) => v.k)),
    disliked: new Set(votes.filter((v) => !v.good).map((v) => v.k)),
    weights: fitViewWeights(votes) || DEFAULT_VIEW_WEIGHTS,
    tuned: !!fitViewWeights(votes),
    count: votes.length,
  };
}

/** Слияние при загрузке файла дневника: по паре берётся более свежая оценка. */
export function mergeVotes(local, incoming) {
  const map = new Map(local.map((v) => [v.k, v]));
  for (const v of incoming || []) if (!map.has(v.k) || map.get(v.k).at < v.at) map.set(v.k, v);
  return [...map.values()].slice(-1000);
}
