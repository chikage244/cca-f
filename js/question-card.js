// Shared question-card renderer used by both quiz (#/quiz) and review
// (#/review) modes. Renders a single question: domain badge + difficulty
// dots, English question text, shuffled choice buttons, instant grading,
// and a Japanese explanation panel. Grading writes through to the SRS map
// via applyAnswer (caller supplies the storage key: "srs.questions").
//
// Single-answer questions (`answer` is an integer) grade on the first tap.
// Multi-answer questions (`answer` is an array, e.g. "choose 2") render
// checkbox-style choices plus a 回答する button that unlocks once exactly
// the required number of choices is selected; they are correct only when
// the selection matches the answer set exactly (no partial credit).

import { el, shuffle } from "./util.js";
import { get, set } from "./store.js";
import { applyAnswer } from "./srs.js";
import { todayStr } from "./util.js";
import { DOMAINS } from "./data.js";

const DOMAIN_BY_ID = new Map(DOMAINS.map((d) => [d.id, d]));

/**
 * Whether the question asks for more than one response ("choose N").
 * @param {Object} question
 * @returns {boolean}
 */
export function isMultiSelect(question) {
  return Array.isArray(question.answer);
}

/**
 * Correct original choice indices as an array (single-answer -> [n]).
 * @param {Object} question
 * @returns {Array<number>}
 */
export function answerIndices(question) {
  return Array.isArray(question.answer) ? question.answer : [question.answer];
}

/**
 * Normalize a stored/chosen answer (number | number[] | null) to an array.
 * @param {number|Array<number>|null|undefined} chosen
 * @returns {Array<number>}
 */
export function chosenIndices(chosen) {
  if (chosen == null) return [];
  return Array.isArray(chosen) ? chosen : [chosen];
}

/**
 * Whether `chosen` selects exactly as many choices as the question requires
 * (used to decide "answered" vs "unanswered" for partial multi-selects).
 * @param {Object} question
 * @param {number|Array<number>|null} chosen
 * @returns {boolean}
 */
export function isAnswerComplete(question, chosen) {
  return chosenIndices(chosen).length === answerIndices(question).length;
}

/**
 * All-or-nothing grading by original choice index.
 * @param {Object} question
 * @param {number|Array<number>|null} chosen
 * @returns {boolean}
 */
export function isAnswerCorrect(question, chosen) {
  const correct = answerIndices(question);
  const picked = chosenIndices(chosen);
  return picked.length === correct.length && correct.every((i) => picked.includes(i));
}

/**
 * "（2つ選べ）" hint shown under the question text of multi-answer questions.
 * @param {Object} question
 * @returns {HTMLElement}
 */
export function renderSelectHint(question) {
  const n = answerIndices(question).length;
  return el("p", { class: "question-card__select-hint" }, `（${n}つ選べ） Choose ${n}`);
}

/**
 * Build a choice button's inner content (English text + optional Japanese).
 * Multi-answer choices get a leading checkbox mark.
 * @param {Object} question
 * @param {number} originalIndex
 * @param {boolean} multi
 * @returns {Array<HTMLElement>}
 */
export function renderChoiceContent(question, originalIndex, multi) {
  const choiceJa = question.choicesJa && question.choicesJa[originalIndex];
  const textNodes = [el("span", { class: "choice__text" }, question.choices[originalIndex])];
  if (choiceJa) {
    textNodes.push(el("span", { class: "choice__text-ja" }, choiceJa));
  }
  if (!multi) return textNodes;
  return [
    el("span", { class: "choice__check", "aria-hidden": "true" }),
    el("span", { class: "choice__body" }, textNodes),
  ];
}

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
 * @param {number|Array<number>|null} [opts.chosenIndex] - required when
 *   readOnly=true. An array of original indices for multi-answer questions.
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
  const multi = isMultiSelect(question);
  const requiredCount = answerIndices(question).length;

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
  if (multi) card.appendChild(renderSelectHint(question));

  // Choices
  const choiceList = el("div", { class: "question-card__choices" });
  const buttons = [];
  const selected = []; // multi-answer only: original indices picked so far
  let answered = false;

  order.forEach((originalIndex) => {
    const btn = el(
      "button",
      {
        class: multi ? "choice choice--multi" : "choice",
        type: "button",
        role: multi ? "checkbox" : undefined,
        "aria-checked": multi ? "false" : undefined,
        onclick: readOnly
          ? undefined
          : () => {
              if (answered) return;
              if (multi) {
                toggleSelection(originalIndex);
                return;
              }
              answered = true;
              grade(originalIndex);
            },
      },
      renderChoiceContent(question, originalIndex, multi)
    );
    if (readOnly) btn.disabled = true;
    buttons.push({ btn, originalIndex });
    choiceList.appendChild(btn);
  });
  card.appendChild(choiceList);

  // Multi-answer: explicit submit, enabled once exactly N are selected.
  const submitBtn = el(
    "button",
    {
      class: "btn btn-primary btn-block question-card__submit",
      type: "button",
      onclick: () => {
        if (answered || selected.length !== requiredCount) return;
        answered = true;
        submitBtn.classList.add("is-hidden");
        grade(selected.slice());
      },
    },
    "回答する"
  );
  if (multi && !readOnly) {
    card.appendChild(submitBtn);
    syncSelection();
  }

  function toggleSelection(originalIndex) {
    const i = selected.indexOf(originalIndex);
    if (i !== -1) {
      selected.splice(i, 1);
    } else if (selected.length < requiredCount) {
      selected.push(originalIndex);
    }
    syncSelection();
  }

  // Reflect `selected` on the buttons: checked state, and once N are picked
  // the remaining choices are locked until one is unchecked.
  function syncSelection() {
    const full = selected.length >= requiredCount;
    buttons.forEach(({ btn, originalIndex }) => {
      const isChecked = selected.includes(originalIndex);
      btn.classList.toggle("is-checked", isChecked);
      btn.setAttribute("aria-checked", isChecked ? "true" : "false");
      btn.disabled = full && !isChecked;
    });
    submitBtn.disabled = selected.length !== requiredCount;
    submitBtn.textContent =
      selected.length === requiredCount ? "回答する" : `回答する（${selected.length}/${requiredCount} 選択中）`;
  }

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

  function grade(chosen) {
    renderGraded(chosen, { writeSrs: true });
  }

  function renderGraded(chosen, { writeSrs }) {
    const isCorrect = isAnswerCorrect(question, chosen);
    const correctSet = answerIndices(question);
    const picked = chosenIndices(chosen);

    buttons.forEach(({ btn, originalIndex }) => {
      btn.disabled = true;
      if (multi) {
        const isPicked = picked.includes(originalIndex);
        btn.classList.toggle("is-checked", isPicked);
        btn.setAttribute("aria-checked", isPicked ? "true" : "false");
      }
      if (correctSet.includes(originalIndex)) {
        btn.classList.add("correct");
      } else if (picked.includes(originalIndex)) {
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
    let label;
    if (picked.length === 0) {
      label = "未回答";
    } else if (isCorrect) {
      label = "正解！";
    } else if (multi) {
      // All-or-nothing, but tell the learner how close they were.
      const hits = picked.filter((i) => correctSet.includes(i)).length;
      label =
        picked.length < correctSet.length
          ? `不正解（${correctSet.length} つ選ぶところ ${picked.length} つだけ選択）`
          : `不正解（選んだ ${picked.length} つのうち正解は ${hits} つ）`;
    } else {
      label = "不正解";
    }
    explanationPanel.appendChild(el("p", { class: "question-card__explanation-label" }, label));
    // Explanations are written as 【かみくだくと】…【正解】…【誤答】…【補足】…; one paragraph per part.
    question.explanation
      .split(/(?=【(?:かみくだくと|正解|誤答|補足)】)/)
      .forEach((part) => explanationPanel.appendChild(el("p", {}, part.trim())));
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
