// Dashboard view (#/) — home screen: due review count, per-domain accuracy,
// coverage + box-distribution mini bars, last exam score, "today's review"
// CTA. All SRS-derived numbers come from srs.deriveDomainStats — never a
// separately stored stat.

import { el, todayStr } from "./util.js";
import { get } from "./store.js";
import { DOMAINS, loadAllQuestions } from "./data.js";
import { deriveDomainStats, isDue } from "./srs.js";

/**
 * @param {HTMLElement} container
 * @param {Object} params
 */
export async function render(container, params) {
  container.appendChild(el("h1", {}, "ホーム"));

  const slot = el("div", { class: "dashboard-slot" });
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

  slot.innerHTML = "";

  const srsMap = get("srs.questions", {});
  const today = todayStr();
  const dueCount = Object.values(srsMap).filter((entry) => isDue(entry, today)).length;
  const hasAnyProgress = Object.keys(srsMap).length > 0;

  slot.appendChild(renderReviewCta(dueCount, hasAnyProgress));

  const stats = deriveDomainStats(srsMap, allQuestions);
  slot.appendChild(renderDomainStats(stats, hasAnyProgress));

  slot.appendChild(renderLastExamCard());
}

function renderReviewCta(dueCount, hasAnyProgress) {
  const card = el("div", { class: "card dashboard-review-card" });

  const header = el("div", { class: "row-between" }, [
    el("span", { class: "card__title" }, "今日の復習"),
    dueCount > 0 ? el("span", { class: "badge" }, String(dueCount)) : null,
  ]);
  card.appendChild(header);

  if (!hasAnyProgress) {
    card.appendChild(
      el("p", { class: "text-muted" }, "まだ学習履歴がありません。まずは「学習」タブから始めましょう。")
    );
    card.appendChild(
      el("a", { class: "btn btn-secondary btn-block", href: "#/quiz" }, "学習を始める")
    );
  } else if (dueCount > 0) {
    card.appendChild(
      el("p", { class: "text-muted" }, `復習期限が来ている問題が ${dueCount} 問あります。`)
    );
    card.appendChild(
      el("a", { class: "btn btn-primary btn-block", href: "#/review" }, "今日の復習")
    );
  } else {
    card.appendChild(el("p", { class: "text-muted" }, "due中の問題はありません。お疲れさまでした。"));
    card.appendChild(
      el("a", { class: "btn btn-secondary btn-block", href: "#/review" }, "追加で学習する")
    );
  }

  return card;
}

function renderDomainStats(stats, hasAnyProgress) {
  const card = el("div", { class: "card" });
  card.appendChild(el("p", { class: "card__title" }, "ドメイン別 正答率"));

  if (!hasAnyProgress) {
    card.appendChild(el("p", { class: "text-muted" }, "学習を始めるとここに正答率が表示されます。"));
    return card;
  }

  const list = el("div", { class: "stack domain-stats" });
  for (const domain of DOMAINS) {
    const s = stats[domain.id] || {
      seen: 0,
      total: 0,
      accuracy: 0,
      boxCounts: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };
    list.appendChild(renderDomainRow(domain, s));
  }
  card.appendChild(list);
  return card;
}

function renderDomainRow(domain, s) {
  const accuracyPct = Math.round(s.accuracy * 100);
  const row = el("div", { class: "domain-stat-row" });

  row.appendChild(
    el("div", { class: "row-between" }, [
      el("span", {}, domain.nameJa),
      el("span", { class: "text-muted" }, `${accuracyPct}% (${s.seen}/${s.total})`),
    ])
  );

  row.appendChild(
    el("div", { class: "progress" }, [
      el("div", {
        class: `progress__fill${accuracyPct >= 72 ? " is-pass" : s.seen > 0 && accuracyPct < 50 ? " is-fail" : ""}`,
        style: `width: ${accuracyPct}%`,
      }),
    ])
  );

  row.appendChild(renderBoxDistribution(s.boxCounts, s.total));

  return row;
}

function renderBoxDistribution(boxCounts, total) {
  const wrap = el("div", { class: "box-distribution", "aria-label": "習熟度分布" });
  if (total === 0) return wrap;
  for (let box = 0; box <= 5; box++) {
    const count = boxCounts[box] || 0;
    if (count === 0) continue;
    const pct = Math.max((count / total) * 100, 2);
    wrap.appendChild(
      el("span", {
        class: `box-distribution__seg box-distribution__seg--${box}`,
        style: `width: ${pct}%`,
        title: `Box ${box}: ${count}問`,
      })
    );
  }
  return wrap;
}

function renderLastExamCard() {
  const history = get("exam.history", []);
  const card = el("div", { class: "card" });
  card.appendChild(el("p", { class: "card__title" }, "模擬試験"));

  if (!history || history.length === 0) {
    card.appendChild(el("p", { class: "text-muted" }, "まだ模試を受けていません。"));
    card.appendChild(el("a", { class: "btn btn-secondary btn-block", href: "#/exam" }, "模試を始める"));
    return card;
  }

  const last = history[history.length - 1];
  const passBadge = el(
    "span",
    { class: `badge ${last.passed ? "badge-success" : ""}` },
    last.passed ? "合格" : "不合格"
  );

  card.appendChild(
    el("div", { class: "row-between" }, [
      el("span", {}, `前回スコア: ${last.scaled} / 1000`),
      passBadge,
    ])
  );
  card.appendChild(el("a", { class: "btn btn-secondary btn-block", href: "#/history" }, "履歴を見る"));

  return card;
}
