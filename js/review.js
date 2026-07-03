// Review view (#/review) — SRS due-queue session. Builds a queue of
// settings.reviewSessionSize (default 10) via buildReviewQueue, reuses the
// shared question-card renderer, re-appends wrong answers once to the end
// of the queue (without double-counting stats — grading already happened
// in question-card), and shows a session summary at the end.

import { el } from "./util.js";
import { get } from "./store.js";
import { loadAllQuestions } from "./data.js";
import { buildReviewQueue, deriveDomainStats } from "./srs.js";
import { renderQuestionCard } from "./question-card.js";
import { DOMAINS } from "./data.js";

const DEFAULT_SESSION_SIZE = 10;

// Session state (module-level; reset on each render/unmount).
let session = null;

/**
 * @param {HTMLElement} container
 * @param {Object} params
 */
export async function render(container, params) {
  container.appendChild(el("h1", {}, "復習"));

  const slot = el("div", { class: "review-slot" });
  container.appendChild(slot);

  slot.appendChild(el("p", { class: "text-muted" }, "読み込み中..."));

  let allQuestions;
  try {
    allQuestions = await loadAllQuestions();
  } catch (err) {
    slot.innerHTML = "";
    slot.appendChild(el("p", { class: "text-muted" }, "問題データの読み込みに失敗しました。"));
    return;
  }

  startSession(allQuestions, slot);
}

function getSessionSize() {
  const settings = get("settings", {});
  const size = settings.reviewSessionSize;
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_SESSION_SIZE;
}

function computeDomainAccuracy(allQuestions) {
  const srsMap = get("srs.questions", {});
  const stats = deriveDomainStats(srsMap, allQuestions);
  const accuracy = {};
  for (const [domainId, s] of Object.entries(stats)) {
    accuracy[domainId] = s.accuracy;
  }
  return accuracy;
}

function startSession(allQuestions, slot, opts = {}) {
  const { backfillOnly = false } = opts;
  const sessionSize = getSessionSize();
  const srsMap = get("srs.questions", {});
  const domainAccuracy = computeDomainAccuracy(allQuestions);

  const queue = buildReviewQueue(srsMap, allQuestions, sessionSize, domainAccuracy);

  if (queue.length === 0) {
    renderEmptyState(slot, allQuestions);
    return;
  }

  session = {
    queue,
    totalPlanned: queue.length,
    cursor: 0,
    correctCount: 0,
    answeredCount: 0,
    domainsTouched: new Set(),
    requeuedIds: new Set(), // ids already re-appended once; avoid infinite loop
  };

  renderCurrentQuestion(allQuestions, slot);
}

function renderEmptyState(slot, allQuestions) {
  slot.innerHTML = "";
  slot.appendChild(
    el("div", { class: "card text-center" }, [
      el("p", { class: "review-empty__title" }, "今日の復習は完了！"),
      el("p", { class: "text-muted" }, "due中の問題はありません。追加で未学習の問題に取り組みますか？"),
      el(
        "button",
        {
          class: "btn btn-primary btn-block",
          type: "button",
          onclick: () => startSession(allQuestions, slot, { backfillOnly: true }),
        },
        "追加で学習する"
      ),
    ])
  );
}

function renderCurrentQuestion(allQuestions, slot) {
  slot.innerHTML = "";

  if (!session || session.cursor >= session.queue.length) {
    renderSummary(allQuestions, slot);
    return;
  }

  const question = session.queue[session.cursor];
  const progressLabel = `${session.cursor + 1}/${session.queue.length}`;

  const progressWrap = el("div", { class: "review-progress" }, [
    el("div", { class: "row-between" }, [
      el("span", { class: "text-muted" }, "進捗"),
      el("span", { class: "text-muted" }, progressLabel),
    ]),
    el("div", { class: "progress" }, [
      el("div", {
        class: "progress__fill",
        style: `width: ${Math.round(((session.cursor) / session.queue.length) * 100)}%`,
      }),
    ]),
  ]);
  slot.appendChild(progressWrap);

  const settings = get("settings", {});
  const shuffleChoices = settings.shuffleChoices !== false;

  renderQuestionCard(slot, question, {
    shuffleChoices,
    onAnswered: (isCorrect) => {
      session.answeredCount += 1;
      session.domainsTouched.add(question.domain);
      if (isCorrect) {
        session.correctCount += 1;
      } else if (!session.requeuedIds.has(question.id)) {
        // Re-append the missed question once to the END of the queue.
        // Stats are NOT re-counted here — grading (SRS write + tally) only
        // happens inside question-card's onAnswered, which fires again
        // naturally when this re-appended card is answered.
        session.requeuedIds.add(question.id);
        session.queue.push(question);
      }
    },
    onNext: () => {
      session.cursor += 1;
      renderCurrentQuestion(allQuestions, slot);
    },
  });
}

function renderSummary(allQuestions, slot) {
  slot.innerHTML = "";

  const domainNames = DOMAINS.filter((d) => session.domainsTouched.has(d.id)).map((d) => d.nameJa);

  slot.appendChild(
    el("div", { class: "card text-center" }, [
      el("p", { class: "card__title" }, "セッション完了"),
      el(
        "p",
        { class: "review-summary__score" },
        `${session.correctCount} / ${session.answeredCount} 問正解`
      ),
      el(
        "p",
        { class: "text-muted" },
        domainNames.length > 0 ? `対象ドメイン: ${domainNames.join("、")}` : "対象ドメイン: -"
      ),
      el(
        "button",
        {
          class: "btn btn-primary btn-block",
          type: "button",
          onclick: () => startSession(allQuestions, slot),
        },
        "もう10問"
      ),
    ])
  );
}

export function unmount() {
  session = null;
}
