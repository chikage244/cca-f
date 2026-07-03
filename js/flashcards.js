// Flashcards view (#/cards) — domain filter chips, tap-to-flip card
// (English term -> Japanese definition), 知らない/知ってる feed the
// SEPARATE srs.cards map via the same srs.applyAnswer engine used by
// questions. Ordering: due first (reusing srs helpers), then unseen.

import { el, todayStr } from "./util.js";
import { get, set } from "./store.js";
import { DOMAINS, loadFlashcards } from "./data.js";
import { applyAnswer, isDue } from "./srs.js";

// Session state (module-level; reset on each render/unmount).
let selectedDomain = "all";
let allCards = [];
let queue = [];
let cursor = 0;
let flipped = false;

/**
 * @param {HTMLElement} container
 * @param {Object} params
 */
export async function render(container, params) {
  container.appendChild(el("h1", {}, "カード"));

  const chipRow = el("div", { class: "chip-row" });
  chipRow.appendChild(
    el(
      "button",
      {
        class: `chip${selectedDomain === "all" ? " active" : ""}`,
        type: "button",
        onclick: () => selectDomain("all"),
      },
      "全部"
    )
  );
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

  const slot = el("div", { class: "cards-slot" });
  container.appendChild(slot);
  slot.appendChild(el("p", { class: "text-muted" }, "読み込み中..."));

  try {
    allCards = await loadFlashcards();
  } catch (err) {
    slot.innerHTML = "";
    slot.appendChild(el("p", { class: "text-muted" }, "カードデータの読み込みに失敗しました。"));
    return;
  }

  function selectDomain(domainId) {
    selectedDomain = domainId;
    Array.from(chipRow.children).forEach((chip, i) => {
      const isAll = i === 0;
      chip.classList.toggle("active", isAll ? domainId === "all" : DOMAINS[i - 1].id === domainId);
    });
    buildQueue();
    renderCurrentCard(slot);
  }

  buildQueue();
  renderCurrentCard(slot);
}

function buildQueue() {
  const filtered =
    selectedDomain === "all" ? allCards : allCards.filter((c) => c.domain === selectedDomain);

  const srsMap = get("srs.cards", {});
  const today = todayStr();

  const due = [];
  const unseen = [];
  const rest = [];

  for (const card of filtered) {
    const entry = srsMap[card.id];
    if (!entry) {
      unseen.push(card);
    } else if (isDue(entry, today)) {
      due.push({ card, entry });
    } else {
      rest.push(card);
    }
  }

  due.sort((a, b) => {
    if (a.entry.box !== b.entry.box) return a.entry.box - b.entry.box;
    return a.entry.due < b.entry.due ? -1 : a.entry.due > b.entry.due ? 1 : 0;
  });

  queue = [...due.map((d) => d.card), ...unseen, ...rest];
  cursor = 0;
  flipped = false;
}

function renderCurrentCard(slot) {
  slot.innerHTML = "";
  flipped = false;

  if (queue.length === 0) {
    slot.appendChild(
      el("div", { class: "card text-center" }, [
        el("p", {}, "このドメインにはまだカードがありません。"),
      ])
    );
    return;
  }

  if (cursor >= queue.length) {
    slot.appendChild(
      el("div", { class: "card text-center" }, [
        el("p", { class: "review-empty__title" }, "このデッキは完了！"),
        el("p", { class: "text-muted" }, `${queue.length} 枚を確認しました。`),
        el(
          "button",
          {
            class: "btn btn-primary btn-block",
            type: "button",
            onclick: () => {
              buildQueue();
              renderCurrentCard(slot);
            },
          },
          "もう一度"
        ),
      ])
    );
    return;
  }

  const card = queue[cursor];
  const domainMeta = DOMAINS.find((d) => d.id === card.domain);

  const counter = el(
    "p",
    { class: "text-muted cards-counter" },
    `${cursor + 1} / ${queue.length}`
  );
  slot.appendChild(counter);

  const flipCard = el("div", { class: "flip-card", role: "button", tabindex: "0" });
  const flipInner = el("div", { class: "flip-card__inner" });

  const front = el("div", { class: "flip-card__face flip-card__face--front" }, [
    el("span", { class: "badge badge-neutral flip-card__badge" }, domainMeta ? domainMeta.nameJa : card.domain),
    el("p", { class: "flip-card__term" }, card.term),
    card.termJa ? el("p", { class: "text-muted flip-card__term-ja" }, card.termJa) : null,
    el("p", { class: "text-muted flip-card__hint" }, "タップして解説を見る"),
  ]);

  const back = el("div", { class: "flip-card__face flip-card__face--back" }, [
    el("span", { class: "badge badge-neutral flip-card__badge" }, domainMeta ? domainMeta.nameJa : card.domain),
    el("p", { class: "flip-card__definition" }, card.definition),
  ]);

  flipInner.appendChild(front);
  flipInner.appendChild(back);
  flipCard.appendChild(flipInner);

  const toggleFlip = () => {
    flipped = !flipped;
    flipCard.classList.toggle("is-flipped", flipped);
  };
  flipCard.addEventListener("click", toggleFlip);
  flipCard.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleFlip();
    }
  });

  slot.appendChild(flipCard);

  const actionRow = el("div", { class: "row cards-actions" }, [
    el(
      "button",
      {
        class: "btn btn-secondary btn-block",
        type: "button",
        onclick: () => gradeCard(card, false, slot),
      },
      "知らない"
    ),
    el(
      "button",
      {
        class: "btn btn-primary btn-block",
        type: "button",
        onclick: () => gradeCard(card, true, slot),
      },
      "知ってる"
    ),
  ]);
  slot.appendChild(actionRow);
}

function gradeCard(card, isKnown, slot) {
  const srsMap = get("srs.cards", {});
  const updated = applyAnswer(srsMap, card.id, isKnown, todayStr());
  set("srs.cards", updated);

  cursor += 1;
  renderCurrentCard(slot);
}

export function unmount() {
  queue = [];
  cursor = 0;
  flipped = false;
}
