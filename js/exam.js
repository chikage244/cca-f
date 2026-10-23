// Exam view (#/exam) — timed 60-question mock exam.
//   Intro (rules + resume detection)
//   -> Runner (timer bar, prev/next, flag, grid jump, no grading feedback)
//   -> Results (pass/fail, score bar, per-domain table, full review list)
//
// exam.active persistence shape (ccaf.v1.exam.active):
//   { startedAt: epoch ms, durationSec: 7200, questionIds: string[60],
//     answers: (number|number[]|null)[60], flagged: string[] (question ids),
//     cursor: number, choiceOrders: number[][] }
// answers[i] is the chosen original choice index for single-answer
// questions, or an array of chosen original indices for multi-answer
// ("choose N") questions (null when nothing is selected). Exams saved before
// multi-answer support only contain numbers/null and load unchanged.
// choiceOrders[i] is the per-question shuffled display order (array of
// original choice indices), generated once at start and persisted so a
// reload/resume keeps the same on-screen order.

import { el, formatTime, sampleWithoutReplacement, shuffle, todayStr } from "./util.js";
import { get, set, remove } from "./store.js";
import { DOMAINS, loadQuestions } from "./data.js";
import { applyAnswer } from "./srs.js";
import {
  renderQuestionCard,
  renderChoiceContent,
  renderSelectHint,
  isMultiSelect,
  answerIndices,
  chosenIndices,
  isAnswerComplete,
  isAnswerCorrect,
} from "./question-card.js";

const DURATION_SEC = 7200; // 120 minutes
const TOTAL_QUESTIONS = 60;
const PASS_SCALED = 720;
const HISTORY_CAP = 30;
// Multi-answer ("choose N") items per mock exam, drawn from across domains
// within the fixed per-domain split (16/12/12/11/9).
const EXAM_MULTI_COUNT = 4;

const DOMAIN_BY_ID = new Map(DOMAINS.map((d) => [d.id, d]));

// Runner-only in-memory state (not persisted beyond exam.active itself).
let tickHandle = null;
let questionsById = null; // Map<id, question> for the active exam
let boundVisibilityHandler = null;
let boundPageShowHandler = null;
let mounted = false;

/**
 * @param {HTMLElement} container
 * @param {Object} params
 */
export async function render(container, params) {
  mounted = true;
  const active = get("exam.active", null);

  if (active) {
    await renderResumeOrRunner(container, active);
  } else {
    renderIntro(container);
  }
}

export function unmount() {
  mounted = false;
  stopTicking();
  document.body.classList.remove("exam-in-progress");
  if (boundVisibilityHandler) {
    document.removeEventListener("visibilitychange", boundVisibilityHandler);
    boundVisibilityHandler = null;
  }
  if (boundPageShowHandler) {
    window.removeEventListener("pageshow", boundPageShowHandler);
    boundPageShowHandler = null;
  }
}

/* ---------------------------------------------------------------------
 * Intro screen
 * ------------------------------------------------------------------- */

function renderIntro(container) {
  container.appendChild(el("h1", {}, "模試"));

  const card = el("div", { class: "card" });
  card.appendChild(el("p", { class: "card__title" }, "模擬試験について"));
  card.appendChild(
    el("ul", { class: "exam-rules" }, [
      el("li", {}, `60問 (シナリオ形式。うち${EXAM_MULTI_COUNT}問は「2つ選べ」の複数選択)`),
      el("li", {}, "制限時間 120分"),
      el("li", {}, "開始後は中断できません (中止すると記録は残りません)"),
      el("li", {}, "合格ラインは 1000点満点中 720点"),
    ])
  );
  container.appendChild(card);

  const startBtn = el(
    "button",
    {
      class: "btn btn-primary btn-block",
      type: "button",
      onclick: () => startNewExam(container),
    },
    "模試を開始"
  );
  container.appendChild(startBtn);
}

async function startNewExam(container) {
  container.innerHTML = "";
  container.appendChild(el("p", { class: "text-muted" }, "問題を準備中..."));

  let questionIds, choiceOrders;
  try {
    const built = await buildExamQuestionSet();
    questionIds = built.questionIds;
    choiceOrders = built.choiceOrders;
  } catch (err) {
    container.innerHTML = "";
    container.appendChild(el("p", { class: "text-muted" }, "問題データの読み込みに失敗しました。"));
    return;
  }

  const active = {
    startedAt: Date.now(),
    durationSec: DURATION_SEC,
    questionIds,
    answers: new Array(questionIds.length).fill(null),
    flagged: [],
    cursor: 0,
    choiceOrders,
  };
  set("exam.active", active);

  container.innerHTML = "";
  await renderResumeOrRunner(container, active, { skipResumePrompt: true });
}

/**
 * Sample per-domain counts (16/12/12/11/9) without replacement, then
 * interleave-shuffle the combined 60. EXAM_MULTI_COUNT multi-answer items are
 * picked first (from any domain) and count toward their domain's quota; the
 * rest of each quota is filled with single-answer items. Also pre-computes a
 * stable per-question choice display order (persisted so reload doesn't
 * reshuffle choices).
 */
async function buildExamQuestionSet() {
  const lists = await Promise.all(DOMAINS.map((d) => loadQuestions(d.id)));
  const byDomain = new Map(DOMAINS.map((d, i) => [d.id, lists[i]]));

  const multiPool = lists.flat().filter(isMultiSelect);
  const pickedMulti = sampleWithoutReplacement(multiPool, Math.min(EXAM_MULTI_COUNT, multiPool.length));

  let combined = [];
  for (const domain of DOMAINS) {
    const pool = byDomain.get(domain.id) || [];
    const forced = pickedMulti.filter((q) => q.domain === domain.id).slice(0, domain.examCount);
    const singles = pool.filter((q) => !isMultiSelect(q));
    const sampled = sampleWithoutReplacement(singles, domain.examCount - forced.length);
    combined.push(...forced, ...sampled);
  }
  combined = shuffle(combined);

  const questionIds = combined.map((q) => q.id);
  const choiceOrders = combined.map((q) => shuffle(q.choices.map((_, i) => i)));

  return { questionIds, choiceOrders };
}

/* ---------------------------------------------------------------------
 * Resume detection / loading questions for an active exam
 * ------------------------------------------------------------------- */

async function renderResumeOrRunner(container, active, opts = {}) {
  const { skipResumePrompt = false } = opts;

  // Load the full question objects referenced by questionIds.
  let allQuestions;
  try {
    allQuestions = (await Promise.all(DOMAINS.map((d) => loadQuestions(d.id)))).flat();
  } catch (err) {
    container.innerHTML = "";
    container.appendChild(el("p", { class: "text-muted" }, "問題データの読み込みに失敗しました。"));
    return;
  }
  questionsById = new Map(allQuestions.map((q) => [q.id, q]));

  // Missing questions (shouldn't normally happen) would break the runner;
  // guard defensively.
  const missing = active.questionIds.filter((id) => !questionsById.has(id));
  if (missing.length > 0) {
    container.innerHTML = "";
    container.appendChild(
      el("div", { class: "card text-center" }, [
        el("p", {}, "保存された模試データに問題が見つかりません。破棄してください。"),
        el(
          "button",
          {
            class: "btn btn-secondary btn-block",
            type: "button",
            onclick: () => {
              remove("exam.active");
              container.innerHTML = "";
              renderIntro(container);
            },
          },
          "破棄して新規開始"
        ),
      ])
    );
    return;
  }

  const remaining = computeRemainingSec(active);
  if (remaining <= 0) {
    await finishExam(container, active, { auto: true });
    return;
  }

  if (skipResumePrompt) {
    renderRunner(container, active);
    return;
  }

  container.appendChild(el("h1", {}, "模試"));
  const card = el("div", { class: "card" });
  card.appendChild(el("p", { class: "card__title" }, "進行中の模試があります"));
  card.appendChild(
    el("p", { class: "text-muted" }, `残り時間: ${formatTime(remaining)}`)
  );
  card.appendChild(
    el(
      "button",
      {
        class: "btn btn-primary btn-block",
        type: "button",
        onclick: () => {
          container.innerHTML = "";
          renderRunner(container, active);
        },
      },
      "試験を再開"
    )
  );
  card.appendChild(
    el(
      "button",
      {
        class: "btn btn-secondary btn-block exam-discard-btn",
        type: "button",
        onclick: () => {
          if (window.confirm("進行中の模試を破棄しますか？記録は残りません。")) {
            remove("exam.active");
            container.innerHTML = "";
            renderIntro(container);
          }
        },
      },
      "破棄して新規開始"
    )
  );
  container.appendChild(card);
}

function computeRemainingSec(active) {
  const elapsedSec = (Date.now() - active.startedAt) / 1000;
  return active.durationSec - elapsedSec;
}

/* ---------------------------------------------------------------------
 * Runner
 * ------------------------------------------------------------------- */

function renderRunner(container, active) {
  document.body.classList.add("exam-in-progress");

  const timerBar = el("div", { class: "exam-timer-bar" });
  const timerLabel = el("span", { class: "exam-timer-bar__time" }, "");
  const abortBtn = el(
    "button",
    {
      class: "exam-timer-bar__abort",
      type: "button",
      onclick: () => confirmAbort(container),
    },
    "中止"
  );
  timerBar.appendChild(timerLabel);
  timerBar.appendChild(abortBtn);
  container.appendChild(timerBar);

  const progressLabel = el("p", { class: "text-muted exam-progress-label" }, "");
  container.appendChild(progressLabel);

  const questionSlot = el("div", { class: "exam-question-slot" });
  container.appendChild(questionSlot);

  const navRow = el("div", { class: "row exam-nav-row" });
  const prevBtn = el(
    "button",
    { class: "btn btn-secondary", type: "button", onclick: () => moveTo(active, active.cursor - 1, refs) },
    "前へ"
  );
  const flagBtn = el(
    "button",
    { class: "btn btn-secondary", type: "button", onclick: () => toggleFlag(active, refs) },
    "見直し"
  );
  const gridBtn = el(
    "button",
    { class: "btn btn-secondary", type: "button", onclick: () => openGridSheet(active, refs) },
    "一覧"
  );
  const nextBtn = el(
    "button",
    { class: "btn btn-primary", type: "button", onclick: () => moveTo(active, active.cursor + 1, refs) },
    "次へ"
  );
  navRow.appendChild(prevBtn);
  navRow.appendChild(flagBtn);
  navRow.appendChild(gridBtn);
  navRow.appendChild(nextBtn);
  container.appendChild(navRow);

  const submitBtn = el(
    "button",
    {
      class: "btn btn-primary btn-block exam-submit-btn",
      type: "button",
      onclick: () => confirmSubmit(container, active),
    },
    "提出する"
  );
  container.appendChild(submitBtn);

  const refs = { timerLabel, progressLabel, questionSlot, prevBtn, nextBtn, flagBtn, submitBtn };

  renderQuestionAt(active, active.cursor, refs);
  tick(active, refs);
  startTicking(active, refs);

  boundVisibilityHandler = () => {
    if (document.visibilityState === "visible" && mounted) tick(active, refs);
  };
  boundPageShowHandler = () => {
    if (mounted) tick(active, refs);
  };
  document.addEventListener("visibilitychange", boundVisibilityHandler);
  window.addEventListener("pageshow", boundPageShowHandler);
}

function startTicking(active, refs) {
  stopTicking();
  tickHandle = setInterval(() => tick(active, refs), 1000);
}

function stopTicking() {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

function tick(active, refs) {
  if (!mounted) return;
  const remaining = computeRemainingSec(active);
  if (remaining <= 0) {
    refs.timerLabel.textContent = "00:00";
    stopTicking();
    autoSubmit(active);
    return;
  }
  refs.timerLabel.textContent = formatTime(remaining);
  if (remaining <= 300) {
    refs.timerLabel.classList.add("is-urgent");
  }
}

function autoSubmit(active) {
  const container = document.getElementById("view");
  if (!container) return;
  finishExam(container, active, { auto: true });
}

function renderQuestionAt(active, index, refs) {
  const clamped = Math.max(0, Math.min(index, active.questionIds.length - 1));
  active.cursor = clamped;
  set("exam.active", active);

  refs.questionSlot.innerHTML = "";
  refs.progressLabel.textContent = `問題 ${clamped + 1} / ${active.questionIds.length}`;

  refs.prevBtn.disabled = clamped === 0;
  refs.nextBtn.textContent = clamped === active.questionIds.length - 1 ? "最後" : "次へ";
  refs.nextBtn.disabled = clamped === active.questionIds.length - 1;

  const qid = active.questionIds[clamped];
  const question = questionsById.get(qid);
  const choiceOrder = active.choiceOrders[clamped];
  const isFlagged = active.flagged.includes(qid);
  refs.flagBtn.classList.toggle("active", isFlagged);
  refs.flagBtn.textContent = isFlagged ? "見直し ★" : "見直し";

  const card = el("div", { class: "card question-card exam-question-card" });
  const domainMeta = DOMAIN_BY_ID.get(question.domain);
  card.appendChild(
    el("div", { class: "row-between question-card__header" }, [
      el("span", { class: "badge badge-neutral" }, domainMeta ? domainMeta.nameJa : question.domain),
    ])
  );
  card.appendChild(el("p", { class: "question-card__text" }, question.question));
  if (question.questionJa) {
    card.appendChild(el("p", { class: "question-card__text-ja" }, question.questionJa));
  }

  const multi = isMultiSelect(question);
  const requiredCount = answerIndices(question).length;
  const selectCountLabel = el("p", { class: "text-muted question-card__select-count" });
  if (multi) {
    card.appendChild(renderSelectHint(question));
    card.appendChild(selectCountLabel);
  }

  const choiceList = el("div", { class: "question-card__choices" });
  const chosen = active.answers[clamped];
  const buttons = [];
  choiceOrder.forEach((originalIndex) => {
    const btn = el(
      "button",
      {
        class: multi ? "choice choice--multi" : `choice${chosen === originalIndex ? " is-selected" : ""}`,
        type: "button",
        role: multi ? "checkbox" : undefined,
        onclick: () => {
          if (multi) {
            toggleMulti(originalIndex);
            return;
          }
          active.answers[clamped] = originalIndex;
          set("exam.active", active);
          Array.from(choiceList.children).forEach((c) => c.classList.remove("is-selected"));
          btn.classList.add("is-selected");
        },
      },
      renderChoiceContent(question, originalIndex, multi)
    );
    buttons.push({ btn, originalIndex });
    choiceList.appendChild(btn);
  });
  card.appendChild(choiceList);
  refs.questionSlot.appendChild(card);
  if (multi) syncMulti();

  // Multi-answer: toggle a pick (at most requiredCount) and persist the
  // selection as an array of original indices (null when emptied).
  function toggleMulti(originalIndex) {
    const picked = chosenIndices(active.answers[clamped]).slice();
    const i = picked.indexOf(originalIndex);
    if (i !== -1) {
      picked.splice(i, 1);
    } else if (picked.length < requiredCount) {
      picked.push(originalIndex);
    } else {
      return;
    }
    active.answers[clamped] = picked.length > 0 ? picked : null;
    set("exam.active", active);
    syncMulti();
  }

  function syncMulti() {
    const picked = chosenIndices(active.answers[clamped]);
    const full = picked.length >= requiredCount;
    buttons.forEach(({ btn, originalIndex }) => {
      const isChecked = picked.includes(originalIndex);
      btn.classList.toggle("is-checked", isChecked);
      btn.setAttribute("aria-checked", isChecked ? "true" : "false");
      btn.disabled = full && !isChecked;
    });
    selectCountLabel.textContent = `${picked.length} / ${requiredCount} 選択中`;
  }
}

function moveTo(active, index, refs) {
  if (index < 0 || index >= active.questionIds.length) return;
  renderQuestionAt(active, index, refs);
}

function toggleFlag(active, refs) {
  const qid = active.questionIds[active.cursor];
  const i = active.flagged.indexOf(qid);
  if (i === -1) {
    active.flagged.push(qid);
  } else {
    active.flagged.splice(i, 1);
  }
  set("exam.active", active);
  renderQuestionAt(active, active.cursor, refs);
}

function confirmAbort(container) {
  if (window.confirm("模試を中止しますか？ここまでの解答は記録されません。")) {
    remove("exam.active");
    stopTicking();
    document.body.classList.remove("exam-in-progress");
    container.innerHTML = "";
    renderIntro(container);
  }
}

function isAnsweredAt(active, i) {
  return isAnswerComplete(questionsById.get(active.questionIds[i]), active.answers[i]);
}

function confirmSubmit(container, active) {
  // A multi-answer question with fewer picks than required counts as
  // unanswered here (it would be graded incorrect).
  const answeredCount = active.questionIds.filter((_, i) => isAnsweredAt(active, i)).length;
  const unanswered = active.questionIds.length - answeredCount;
  const msg =
    unanswered > 0
      ? `未回答が ${unanswered} 問あります。提出しますか？`
      : "模試を提出しますか？";
  if (window.confirm(msg)) {
    finishExam(container, active, { auto: false });
  }
}

/* ---------------------------------------------------------------------
 * Grid jump sheet
 * ------------------------------------------------------------------- */

function openGridSheet(active, refs) {
  const overlay = el("div", { class: "modal-overlay", onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const sheet = el("div", { class: "sheet" });
  sheet.appendChild(el("p", { class: "card__title" }, "問題一覧"));

  const legend = el("div", { class: "row exam-grid-legend" }, [
    el("span", { class: "exam-grid-legend__item" }, [el("span", { class: "exam-grid-dot exam-grid-dot--answered" }), " 解答済み"]),
    el("span", { class: "exam-grid-legend__item" }, [el("span", { class: "exam-grid-dot exam-grid-dot--flagged" }), " 見直し"]),
    el("span", { class: "exam-grid-legend__item" }, [el("span", { class: "exam-grid-dot" }), " 未回答"]),
  ]);
  sheet.appendChild(legend);

  const grid = el("div", { class: "exam-grid" });
  active.questionIds.forEach((qid, i) => {
    const answered = isAnsweredAt(active, i);
    const flagged = active.flagged.includes(qid);
    const cell = el(
      "button",
      {
        class: `exam-grid__cell${answered ? " is-answered" : ""}${flagged ? " is-flagged" : ""}${i === active.cursor ? " is-current" : ""}`,
        type: "button",
        onclick: () => {
          moveTo(active, i, refs);
          overlay.remove();
        },
      },
      String(i + 1)
    );
    grid.appendChild(cell);
  });
  sheet.appendChild(grid);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

/* ---------------------------------------------------------------------
 * Submit / scoring / results
 * ------------------------------------------------------------------- */

async function finishExam(container, active, opts = {}) {
  stopTicking();
  document.body.classList.remove("exam-in-progress");

  if (!questionsById) {
    const allQuestions = (await Promise.all(DOMAINS.map((d) => loadQuestions(d.id)))).flat();
    questionsById = new Map(allQuestions.map((q) => [q.id, q]));
  }

  const perDomain = {};
  for (const domain of DOMAINS) {
    perDomain[domain.id] = { correct: 0, total: 0 };
  }

  let correctCount = 0;
  const srsMapBefore = get("srs.questions", {});
  let srsMap = srsMapBefore;
  const today = todayStr();

  const detail = []; // per-question review data for results screen

  active.questionIds.forEach((qid, i) => {
    const question = questionsById.get(qid);
    const chosen = active.answers[i];
    const isCorrect = isAnswerCorrect(question, chosen);

    if (perDomain[question.domain]) {
      perDomain[question.domain].total += 1;
      if (isCorrect) perDomain[question.domain].correct += 1;
    }
    if (isCorrect) correctCount += 1;

    srsMap = applyAnswer(srsMap, qid, isCorrect, today);

    detail.push({
      question,
      chosenIndex: chosen,
      choiceOrder: active.choiceOrders[i],
      isCorrect,
    });
  });

  set("srs.questions", srsMap);

  const scaled = Math.round((correctCount / active.questionIds.length) * 1000);
  const passed = scaled >= PASS_SCALED;
  const elapsedSec = Math.min(active.durationSec, (Date.now() - active.startedAt) / 1000);

  const record = {
    finishedAt: Date.now(),
    scaled,
    correct: correctCount,
    total: active.questionIds.length,
    passed,
    perDomain,
    elapsedSec,
    auto: !!opts.auto,
  };

  const history = get("exam.history", []);
  history.push(record);
  while (history.length > HISTORY_CAP) history.shift();
  set("exam.history", history);

  remove("exam.active");

  container.innerHTML = "";
  renderResults(container, record, detail);
}

function renderResults(container, record, detail) {
  container.appendChild(el("h1", {}, "模試 結果"));

  const summaryCard = el("div", { class: "card text-center" });
  summaryCard.appendChild(
    el(
      "span",
      { class: `badge exam-result-badge ${record.passed ? "badge-success" : ""}` },
      record.passed ? "合格" : "不合格"
    )
  );
  summaryCard.appendChild(el("p", { class: "exam-result-score" }, `${record.scaled} / 1000`));

  const barWrap = el("div", { class: "exam-score-bar" });
  const fillPct = Math.min(100, (record.scaled / 1000) * 100);
  barWrap.appendChild(
    el("div", {
      class: `exam-score-bar__fill${record.passed ? " is-pass" : " is-fail"}`,
      style: `width: ${fillPct}%`,
    })
  );
  barWrap.appendChild(el("div", { class: "exam-score-bar__marker", style: "left: 72%" }));
  summaryCard.appendChild(barWrap);
  summaryCard.appendChild(el("p", { class: "text-muted exam-score-note" }, "720点ライン"));

  summaryCard.appendChild(
    el(
      "p",
      { class: "text-muted" },
      `正解 ${record.correct} / ${record.total} 問・所要時間 ${formatTime(record.elapsedSec)}`
    )
  );
  summaryCard.appendChild(
    el("p", { class: "text-muted exam-disclaimer" }, "※実試験のスコアは統計的調整あり")
  );
  container.appendChild(summaryCard);

  // Per-domain table
  const domainCard = el("div", { class: "card" });
  domainCard.appendChild(el("p", { class: "card__title" }, "ドメイン別内訳"));
  const table = el("table", { class: "exam-domain-table" });
  const thead = el("thead", {}, [
    el("tr", {}, [el("th", {}, "ドメイン"), el("th", {}, "正解"), el("th", {}, "正答率")]),
  ]);
  table.appendChild(thead);
  const tbody = el("tbody");
  for (const domain of DOMAINS) {
    const d = record.perDomain[domain.id] || { correct: 0, total: 0 };
    const pct = d.total > 0 ? Math.round((d.correct / d.total) * 100) : 0;
    tbody.appendChild(
      el("tr", {}, [
        el("td", {}, domain.nameJa),
        el("td", {}, `${d.correct} / ${d.total}`),
        el("td", {}, `${pct}%`),
      ])
    );
  }
  table.appendChild(tbody);
  domainCard.appendChild(el("div", { class: "table-scroll" }, [table]));
  container.appendChild(domainCard);

  const backBtn = el(
    "a",
    { class: "btn btn-secondary btn-block", href: "#/history" },
    "履歴を見る"
  );
  container.appendChild(backBtn);

  const retryBtn = el(
    "button",
    {
      class: "btn btn-primary btn-block exam-retry-btn",
      type: "button",
      onclick: () => {
        container.innerHTML = "";
        renderIntro(container);
      },
    },
    "もう一度挑戦する"
  );
  container.appendChild(retryBtn);

  // Full review list of all 60 questions.
  container.appendChild(el("h2", { class: "exam-review-heading" }, "全問題の見直し"));
  const reviewList = el("div", { class: "exam-review-list" });
  detail.forEach((item, i) => {
    const wrap = el("div", { class: "exam-review-item" });
    wrap.appendChild(el("p", { class: "text-muted exam-review-item__index" }, `問題 ${i + 1}`));
    renderQuestionCard(wrap, item.question, {
      readOnly: true,
      hideNext: true,
      choiceOrder: item.choiceOrder,
      chosenIndex: item.chosenIndex,
    });
    reviewList.appendChild(wrap);
  });
  container.appendChild(reviewList);
}
