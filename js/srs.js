// Pure-function 6-box Leitner SRS engine.
// Box 0 = unseen (no entry in srsMap yet). Boxes 1-5 are the active review boxes.
// Interval by box (days added to "today" to compute the new due date):
//   box 1 = 0 (same day)   box 2 = +1   box 3 = +3   box 4 = +7   box 5 = +14

import { todayStr } from "./util.js";

const BOX_INTERVAL_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 };

/**
 * Add `days` to a local YYYY-MM-DD date string, returning a new
 * YYYY-MM-DD string. Pure (no mutation of global state, no timezone drift
 * beyond local calendar arithmetic).
 * @param {string} dateStr
 * @param {number} days
 * @returns {string}
 */
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Apply an answer to a question/card's SRS entry and return the updated map
 * (a new object; srsMap is not mutated).
 * @param {Object} srsMap - map of id -> { box, due, correct, wrong, lapses, last }
 * @param {string} id
 * @param {boolean} isCorrect
 * @param {string} today - local YYYY-MM-DD
 * @returns {Object} new srsMap with the entry for `id` updated
 */
export function applyAnswer(srsMap, id, isCorrect, today) {
  const prev = srsMap[id] || null;
  const prevBox = prev ? prev.box : 0;

  let entry;
  if (!prev) {
    // First time seeing this item.
    entry = isCorrect
      ? { box: 2, due: addDays(today, 1), correct: 1, wrong: 0, lapses: 0, last: today }
      : { box: 1, due: today, correct: 0, wrong: 1, lapses: 0, last: today };
  } else if (isCorrect) {
    const newBox = Math.min(prevBox + 1, 5);
    entry = {
      box: newBox,
      due: addDays(today, BOX_INTERVAL_DAYS[newBox]),
      correct: prev.correct + 1,
      wrong: prev.wrong,
      lapses: prev.lapses,
      last: today,
    };
  } else {
    const lapses = prevBox >= 3 ? prev.lapses + 1 : prev.lapses;
    entry = {
      box: 1,
      due: today,
      correct: prev.correct,
      wrong: prev.wrong + 1,
      lapses,
      last: today,
    };
  }

  return { ...srsMap, [id]: entry };
}

/**
 * Whether an SRS entry is due for review on the given day.
 * @param {Object} entry - { box, due, ... } or null/undefined (unseen)
 * @param {string} today - local YYYY-MM-DD
 * @returns {boolean}
 */
export function isDue(entry, today) {
  if (!entry) return false;
  return entry.due <= today;
}

/**
 * Build a review session queue.
 * Due items first, sorted by box ascending, then due date ascending
 * (most overdue first), then lapses descending. If there aren't enough
 * due items to fill sessionSize, backfill with unseen questions, preferring
 * the domain with the lowest accuracy.
 *
 * @param {Object} srsMap - id -> entry
 * @param {Array} allQuestions - full question list (all domains)
 * @param {number} sessionSize
 * @param {Object} [domainAccuracy] - domainId -> accuracy (0-1), lower = prioritized
 * @returns {Array} array of question objects, length <= sessionSize
 */
export function buildReviewQueue(srsMap, allQuestions, sessionSize, domainAccuracy = {}) {
  const today = todayStr();
  const byId = new Map(allQuestions.map((q) => [q.id, q]));

  const dueEntries = [];
  for (const [id, entry] of Object.entries(srsMap)) {
    if (isDue(entry, today) && byId.has(id)) {
      dueEntries.push({ id, entry });
    }
  }

  dueEntries.sort((a, b) => {
    if (a.entry.box !== b.entry.box) return a.entry.box - b.entry.box;
    if (a.entry.due !== b.entry.due) return a.entry.due < b.entry.due ? -1 : 1;
    return b.entry.lapses - a.entry.lapses;
  });

  const queue = dueEntries.slice(0, sessionSize).map(({ id }) => byId.get(id));

  if (queue.length < sessionSize) {
    const seenIds = new Set(Object.keys(srsMap));
    const unseen = allQuestions.filter((q) => !seenIds.has(q.id));

    // Sort unseen by domain accuracy ascending (lowest accuracy first).
    // Domains without a recorded accuracy are treated as highest priority
    // (accuracy 0) so new/weak domains surface first.
    unseen.sort((a, b) => {
      const accA = domainAccuracy[a.domain] ?? 0;
      const accB = domainAccuracy[b.domain] ?? 0;
      return accA - accB;
    });

    const needed = sessionSize - queue.length;
    queue.push(...unseen.slice(0, needed));
  }

  return queue;
}

/**
 * Derive per-domain stats from the SRS map and question list.
 * @param {Object} srsMap - id -> entry
 * @param {Array} allQuestions - full question list (all domains)
 * @returns {Object} domainId -> { seen, total, correct, wrong, accuracy, dueCount, boxCounts }
 */
export function deriveDomainStats(srsMap, allQuestions) {
  const today = todayStr();
  const stats = {};

  for (const q of allQuestions) {
    if (!stats[q.domain]) {
      stats[q.domain] = {
        seen: 0,
        total: 0,
        correct: 0,
        wrong: 0,
        accuracy: 0,
        dueCount: 0,
        boxCounts: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      };
    }
    const s = stats[q.domain];
    s.total += 1;

    const entry = srsMap[q.id];
    if (entry) {
      s.seen += 1;
      s.correct += entry.correct;
      s.wrong += entry.wrong;
      s.boxCounts[entry.box] = (s.boxCounts[entry.box] || 0) + 1;
      if (isDue(entry, today)) s.dueCount += 1;
    } else {
      s.boxCounts[0] += 1;
    }
  }

  for (const domainId of Object.keys(stats)) {
    const s = stats[domainId];
    const attempts = s.correct + s.wrong;
    s.accuracy = attempts > 0 ? s.correct / attempts : 0;
  }

  return stats;
}
