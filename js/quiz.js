// Quiz view (#/quiz) — domain filter chips + one-question-at-a-time practice
// with immediate scoring and explanation.

import { el } from "./util.js";
import { get } from "./store.js";
import { DOMAINS, loadAllQuestions } from "./data.js";
import { renderQuestionCard } from "./question-card.js";

// Persisted only for the lifetime of the session (module-level, not stored).
let selectedDomain = "all";
let currentQuestion = null;
let pool = [];

/**
 * @param {HTMLElement} container
 * @param {Object} params
 */
export async function render(container, params) {
  container.appendChild(el("h1", {}, "学習"));

  const chipRow = el("div", { class: "chip-row" });
  const allChip = el(
    "button",
    {
      class: `chip${selectedDomain === "all" ? " active" : ""}`,
      type: "button",
      onclick: () => selectDomain("all"),
    },
    "全部"
  );
  chipRow.appendChild(allChip);
  for (const domain of DOMAINS) {
    chipRow.appendChild(
      el(
        "button",
        {
          class: `chip${selectedDomain === domain.id ? " active" : ""}`,
          type: "button",
          onclick: () => selectDomain(domain.id),
        },
        domain.nameJa
      )
    );
  }
  container.appendChild(chipRow);

  const questionSlot = el("div", { class: "quiz-question-slot" });
  container.appendChild(questionSlot);

  let allQuestions;
  try {
    allQuestions = await loadAllQuestions();
  } catch (err) {
    questionSlot.innerHTML = "";
    questionSlot.appendChild(
      el("p", { class: "text-muted" }, "問題データの読み込みに失敗しました。")
    );
    return;
  }

  function selectDomain(domainId) {
    selectedDomain = domainId;
    // Re-render chips' active state without a full view teardown.
    Array.from(chipRow.children).forEach((chip, i) => {
      const isAll = i === 0;
      chip.classList.toggle("active", isAll ? domainId === "all" : DOMAINS[i - 1].id === domainId);
    });
    loadNextQuestion(allQuestions, questionSlot);
  }

  loadNextQuestion(allQuestions, questionSlot);
}

function buildPool(allQuestions) {
  const filtered =
    selectedDomain === "all"
      ? allQuestions
      : allQuestions.filter((q) => q.domain === selectedDomain);

  const srsMap = get("srs.questions", {});
  const unseen = filtered.filter((q) => !srsMap[q.id]);
  const seen = filtered.filter((q) => srsMap[q.id]);

  // Unseen-first, then random from the whole filtered pool once everything
  // has been seen at least once.
  return { unseen, seen, filtered };
}

function pickNext(allQuestions) {
  const { unseen, filtered } = buildPool(allQuestions);
  if (filtered.length === 0) return null;
  if (unseen.length > 0) {
    return unseen[Math.floor(Math.random() * unseen.length)];
  }
  return filtered[Math.floor(Math.random() * filtered.length)];
}

function loadNextQuestion(allQuestions, questionSlot) {
  questionSlot.innerHTML = "";

  const question = pickNext(allQuestions);
  currentQuestion = question;

  if (!question) {
    questionSlot.appendChild(
      el("div", { class: "card text-center" }, [
        el("p", {}, "このドメインにはまだ問題がありません。"),
      ])
    );
    return;
  }

  const settings = get("settings", {});
  const shuffleChoices = settings.shuffleChoices !== false;

  renderQuestionCard(questionSlot, question, {
    shuffleChoices,
    onNext: () => loadNextQuestion(allQuestions, questionSlot),
  });
}

export function unmount() {
  currentQuestion = null;
  pool = [];
}
