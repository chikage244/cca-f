// History view (#/history, #/history/:index) — past exam results list
// (newest first) and detail drill-down with per-domain breakdown.

import { el, formatTime } from "./util.js";
import { get } from "./store.js";
import { DOMAINS } from "./data.js";

/**
 * @param {HTMLElement} container
 * @param {Object} params
 */
export function render(container, params) {
  const history = get("exam.history", []);

  if (params && params.index != null) {
    renderDetail(container, history, params.index);
  } else {
    renderList(container, history);
  }
}

function renderList(container, history) {
  container.appendChild(el("h1", {}, "模試履歴"));

  if (!history || history.length === 0) {
    container.appendChild(
      el("div", { class: "card text-center" }, [
        el("p", { class: "text-muted" }, "まだ模試を受けていません。"),
        el("a", { class: "btn btn-primary btn-block", href: "#/exam" }, "模試を始める"),
      ])
    );
    return;
  }

  const list = el("div", { class: "stack history-list" });
  // Newest first. Detail route uses the index into the stored array
  // (oldest=0), so we must pass the ORIGINAL index, not the display order.
  const withIndex = history.map((record, i) => ({ record, originalIndex: i }));
  withIndex.reverse();

  for (const { record, originalIndex } of withIndex) {
    list.appendChild(renderHistoryRow(record, originalIndex));
  }
  container.appendChild(list);
}

function renderHistoryRow(record, originalIndex) {
  const date = new Date(record.finishedAt);
  const dateStr = formatDate(date);
  const passBadge = el(
    "span",
    { class: `badge ${record.passed ? "badge-success" : ""}` },
    record.passed ? "合格" : "不合格"
  );

  return el(
    "a",
    { class: "card history-row", href: `#/history/${originalIndex}` },
    [
      el("div", { class: "row-between" }, [
        el("span", { class: "history-row__date" }, dateStr),
        passBadge,
      ]),
      el("div", { class: "row-between" }, [
        el("span", { class: "text-muted" }, `${record.correct} / ${record.total} 問正解`),
        el("span", { class: "history-row__score" }, `${record.scaled} / 1000`),
      ]),
    ]
  );
}

function renderDetail(container, history, indexParam) {
  const index = Number(indexParam);
  const record = history[index];

  const backLink = el("a", { class: "history-back-link", href: "#/history" }, "← 履歴一覧");
  container.appendChild(backLink);
  container.appendChild(el("h1", {}, "模試 詳細"));

  if (!record) {
    container.appendChild(el("p", { class: "text-muted" }, "指定された履歴が見つかりません。"));
    return;
  }

  const date = new Date(record.finishedAt);
  const summaryCard = el("div", { class: "card text-center" });
  summaryCard.appendChild(
    el(
      "span",
      { class: `badge exam-result-badge ${record.passed ? "badge-success" : ""}` },
      record.passed ? "合格" : "不合格"
    )
  );
  summaryCard.appendChild(el("p", { class: "exam-result-score" }, `${record.scaled} / 1000`));
  summaryCard.appendChild(
    el(
      "p",
      { class: "text-muted" },
      `${formatDate(date)}・正解 ${record.correct} / ${record.total} 問`
    )
  );
  if (record.elapsedSec != null) {
    summaryCard.appendChild(
      el("p", { class: "text-muted" }, `所要時間 ${formatTime(record.elapsedSec)}`)
    );
  }
  container.appendChild(summaryCard);

  const domainCard = el("div", { class: "card" });
  domainCard.appendChild(el("p", { class: "card__title" }, "ドメイン別内訳"));
  const table = el("table", { class: "exam-domain-table" });
  table.appendChild(
    el("thead", {}, [
      el("tr", {}, [el("th", {}, "ドメイン"), el("th", {}, "正解"), el("th", {}, "正答率")]),
    ])
  );
  const tbody = el("tbody");
  for (const domain of DOMAINS) {
    const d = (record.perDomain && record.perDomain[domain.id]) || { correct: 0, total: 0 };
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
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${d} ${hh}:${mm}`;
}
