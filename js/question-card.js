// Shared question-card renderer used by both quiz (#/quiz) and review
// (#/review) modes. Renders a single question: domain badge + difficulty
// dots, English question text, 4 shuffled choice buttons, instant grading,
// and a Japanese explanation panel. Grading writes through to the SRS map
// via applyAnswer (caller supplies the storage key: "srs.questions").

import { el, shuffle } from "./util.js";
import { get, set } from "./store.js";
import { applyAnswer } from "./srs.js";
import { todayStr } from "./util.js";
import { DOMAINS } from "./data.js";

const DOMAIN_BY_ID = new Map(DOMAINS.map((d) => [d.id, d]));

/**
 * Render a question card into `container`.
 *
 * @param {HTMLElement} container
 * @param {Object} question - question object per data schema
 * @param {Object} opts
 * @param {boolean} [opts.shuffleChoices=true] - honor settings.shuffleChoices
 * @param {Array<number>} [opts.choiceOrder] - explicit display order of
 *   original choice indices. Overrides shuffleChoices when provided (used by
 *   the exam runner so the order is stable across reloads).
 * @param {Function} opts.onAnswered - (isCorrect: boolean) => void, called
 *   once grading completes and SRS has been updated
 * @param {Function} opts.onNext - () => void, called when the user taps 次へ
 * @param {string} [opts.nextLabel="次へ"]
 * @param {boolean} [opts.readOnly=false] - review/results mode: no SRS write,
 *   no click-to-grade. `chosenIndex` (may be null = unanswered) is rendered
 *   pre-graded and the choices are not clickable.
 * @param {number|null} [opts.chosenIndex] - required when readOnly=true
 * @param {boolean} [opts.hideNext=false] - hide the 次へ button entirely
 *   (readOnly review lists render many cards back-to-back with no nav)
 */
export function renderQuestionCard(container, question, opts) {
  const {
    shuffleChoices = true,
    choiceOrder = null,
    onAnswered,
    onNext,
    nextLabel = "次へ",
    readOnly = false,
    chosenIndex = null,
    hideNext = false,
  } = opts;

  const domainMeta = DOMAIN_BY_ID.get(question.domain);

  const order =
    choiceOrder ||
    (shuffleChoices ? shuffle(question.choices.map((_, i) => i)) : question.choices.map((_, i) => i));

  const card = el("div", { class: "card question-card" });

  // Header: domain badge + difficulty dots
  const header = el("div", { class: "row-between question-card__header" }, [
    el("span", { class: "badge badge-neutral" }, domainMeta ? domainMeta.nameJa : question.domain),
    renderDifficultyDots(question.difficulty),
  ]);
  card.appendChild(header);

  // Question text
  card.appendChild(el("p", { class: "question-card__text" }, question.question));
  if (question.questionJa) {
    card.appendChild(el("p", { class: "question-card__text-ja" }, question.questionJa));
  }

  // Choices
  const choiceList = el("div", { class: "question-card__choices" });
  const buttons = [];
  let answered = false;

  order.forEach((originalIndex) => {
    const choiceJa = question.choicesJa && question.choicesJa[originalIndex];
    const btnChildren = [el("span", { class: "choice__text" }, question.choices[originalIndex])];
    if (choiceJa) {
      btnChildren.push(el("span", { class: "choice__text-ja" }, choiceJa));
    }
    const btn = el(
      "button",
      {
        class: "choice",
        type: "button",
        onclick: readOnly
          ? undefined
          : () => {
              if (answered) return;
              answered = true;
              grade(originalIndex);
            },
      },
      btnChildren
    );
    if (readOnly) btn.disabled = true;
    buttons.push({ btn, originalIndex });
    choiceList.appendChild(btn);
  });
  card.appendChild(choiceList);

  // Explanation panel (hidden until answered)
  const explanationPanel = el("div", { class: "question-card__explanation is-hidden" });
  card.appendChild(explanationPanel);

  // Next button (hidden until answered)
  const nextBtn = el(
    "button",
    {
      class: "btn btn-primary btn-block question-card__next is-hidden",
      type: "button",
      onclick: () => {
        if (typeof onNext === "function") onNext();
      },
    },
    nextLabel
  );
  if (!hideNext) card.appendChild(nextBtn);

  container.appendChild(card);

  if (readOnly) {
    renderGraded(chosenIndex, { writeSrs: false });
  }

  function grade(chosenIdx) {
    renderGraded(chosenIdx, { writeSrs: true });
  }

  function renderGraded(chosenIdx, { writeSrs }) {
    const isCorrect = chosenIdx === question.answer;

    buttons.forEach(({ btn, originalIndex }) => {
      btn.disabled = true;
      if (originalIndex === question.answer) {
        btn.classList.add("correct");
      } else if (chosenIdx != null && originalIndex === chosenIdx) {
        btn.classList.add("wrong");
      }
    });

    if (writeSrs) {
      const srsMap = get("srs.questions", {});
      const updated = applyAnswer(srsMap, question.id, isCorrect, todayStr());
      set("srs.questions", updated);
    }

    // Explanation
    explanationPanel.classList.remove("is-hidden");
    explanationPanel.appendChild(
      el(
        "p",
        { class: "question-card__explanation-label" },
        chosenIdx == null ? "未回答" : isCorrect ? "正解！" : "不正解"
      )
    );
    explanationPanel.appendChild(el("p", {}, question.explanation));
    if (question.ref) {
      explanationPanel.appendChild(el("p", { class: "text-muted question-card__ref" }, `出典: ${question.ref}`));
    }

    if (!hideNext) nextBtn.classList.remove("is-hidden");

    if (typeof onAnswered === "function") onAnswered(isCorrect);
  }
}

function renderDifficultyDots(difficulty) {
  const wrap = el("span", { class: "difficulty-dots", "aria-label": `難易度 ${difficulty}` });
  for (let i = 1; i <= 3; i++) {
    wrap.appendChild(
      el("span", { class: `difficulty-dots__dot${i <= difficulty ? " is-filled" : ""}` })
    );
  }
  return wrap;
}
