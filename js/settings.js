// Settings view (#/settings) — theme, shuffle-choices toggle, review
// session size, progress reset, and full JSON export/import of all
// ccaf.v1.* keys (everything store.js owns).

import { el } from "./util.js";
import { get, set, remove } from "./store.js";

const STORAGE_PREFIX = "ccaf.v1.";
// Keys owned by store.js that make up "progress" (i.e. everything except
// settings itself, which the reset/export flows treat specially).
const PROGRESS_KEYS = ["srs.questions", "srs.cards", "exam.active", "exam.history"];
const ALL_KEYS = [...PROGRESS_KEYS, "settings"];

const DEFAULT_SETTINGS = {
  theme: "system",
  shuffleChoices: true,
  reviewSessionSize: 10,
};

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...get("settings", {}) };
}

function saveSettings(patch) {
  const updated = { ...getSettings(), ...patch };
  set("settings", updated);
  return updated;
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") {
    root.setAttribute("data-theme", theme);
  } else {
    root.removeAttribute("data-theme");
  }
}

/**
 * @param {HTMLElement} container
 * @param {Object} params
 */
export function render(container, params) {
  container.appendChild(el("h1", {}, "設定"));

  container.appendChild(renderThemeCard());
  container.appendChild(renderQuizPrefsCard());
  container.appendChild(renderDataCard(container));
  container.appendChild(renderExportImportCard());
}

/* ---------------------------------------------------------------------
 * Theme
 * ------------------------------------------------------------------- */

function renderThemeCard() {
  const settingsData = getSettings();
  const card = el("div", { class: "card" });
  card.appendChild(el("p", { class: "card__title" }, "テーマ"));

  const options = [
    { value: "system", label: "自動" },
    { value: "light", label: "ライト" },
    { value: "dark", label: "ダーク" },
  ];

  const row = el("div", { class: "chip-row settings-theme-row" });
  options.forEach((opt) => {
    const chip = el(
      "button",
      {
        class: `chip${settingsData.theme === opt.value ? " active" : ""}`,
        type: "button",
        onclick: () => {
          const updated = saveSettings({ theme: opt.value });
          applyTheme(updated.theme);
          Array.from(row.children).forEach((c, i) => {
            c.classList.toggle("active", options[i].value === opt.value);
          });
        },
      },
      opt.label
    );
    row.appendChild(chip);
  });
  card.appendChild(row);
  return card;
}

/* ---------------------------------------------------------------------
 * Quiz / review preferences
 * ------------------------------------------------------------------- */

function renderQuizPrefsCard() {
  const settingsData = getSettings();
  const card = el("div", { class: "card" });
  card.appendChild(el("p", { class: "card__title" }, "学習の設定"));

  // shuffleChoices toggle
  const shuffleRow = el("div", { class: "row-between settings-toggle-row" }, [
    el("span", {}, "選択肢をシャッフルする"),
    renderToggle(settingsData.shuffleChoices !== false, (checked) => {
      saveSettings({ shuffleChoices: checked });
    }),
  ]);
  card.appendChild(shuffleRow);

  // reviewSessionSize
  card.appendChild(el("p", { class: "settings-subtitle" }, "復習セッションの問題数"));
  const sizeRow = el("div", { class: "chip-row" });
  [5, 10, 20].forEach((size) => {
    const chip = el(
      "button",
      {
        class: `chip${settingsData.reviewSessionSize === size ? " active" : ""}`,
        type: "button",
        onclick: () => {
          saveSettings({ reviewSessionSize: size });
          Array.from(sizeRow.children).forEach((c, i) => {
            c.classList.toggle("active", [5, 10, 20][i] === size);
          });
        },
      },
      String(size)
    );
    sizeRow.appendChild(chip);
  });
  card.appendChild(sizeRow);

  return card;
}

function renderToggle(checked, onChange) {
  const btn = el(
    "button",
    {
      class: `toggle-switch${checked ? " is-on" : ""}`,
      type: "button",
      role: "switch",
      "aria-checked": checked ? "true" : "false",
      onclick: () => {
        const next = !btn.classList.contains("is-on");
        btn.classList.toggle("is-on", next);
        btn.setAttribute("aria-checked", next ? "true" : "false");
        onChange(next);
      },
    },
    [el("span", { class: "toggle-switch__thumb" })]
  );
  return btn;
}

/* ---------------------------------------------------------------------
 * Progress reset
 * ------------------------------------------------------------------- */

function renderDataCard(container) {
  const card = el("div", { class: "card" });
  card.appendChild(el("p", { class: "card__title" }, "データ"));
  card.appendChild(
    el(
      "p",
      { class: "text-muted" },
      "学習履歴・SRS状態・模試履歴をすべて削除します。設定 (テーマ等) は保持されます。"
    )
  );
  card.appendChild(
    el(
      "button",
      {
        class: "btn btn-secondary btn-block settings-danger-btn",
        type: "button",
        onclick: () => {
          if (window.confirm("進捗をすべてリセットしますか？この操作は取り消せません。")) {
            for (const key of PROGRESS_KEYS) remove(key);
            container.innerHTML = "";
            render(container, {});
            showToast(container, "進捗をリセットしました");
          }
        },
      },
      "進捗リセット"
    )
  );
  return card;
}

/* ---------------------------------------------------------------------
 * Export / Import
 * ------------------------------------------------------------------- */

function collectAllData() {
  const data = {};
  for (const key of ALL_KEYS) {
    const value = get(key, null);
    if (value != null) data[key] = value;
  }
  return data;
}

function renderExportImportCard() {
  const card = el("div", { class: "card" });
  card.appendChild(el("p", { class: "card__title" }, "進捗のエクスポート / インポート"));
  card.appendChild(
    el(
      "p",
      { class: "text-muted" },
      "端末を機種変更する際などに、全データをJSONとしてコピー・貼り付けできます。"
    )
  );

  const textarea = el("textarea", {
    class: "settings-export-textarea",
    rows: "8",
    spellcheck: "false",
  });
  textarea.value = JSON.stringify(collectAllData(), null, 2);
  card.appendChild(textarea);

  const statusMsg = el("p", { class: "text-muted settings-import-status is-hidden" });

  const btnRow = el("div", { class: "row settings-export-actions" });
  const copyBtn = el(
    "button",
    {
      class: "btn btn-secondary",
      type: "button",
      onclick: async () => {
        textarea.value = JSON.stringify(collectAllData(), null, 2);
        try {
          await navigator.clipboard.writeText(textarea.value);
          setStatus(statusMsg, "コピーしました", false);
        } catch (err) {
          textarea.select();
          setStatus(statusMsg, "コピーできませんでした。手動で選択してコピーしてください。", true);
        }
      },
    },
    "コピー"
  );
  const importBtn = el(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      onclick: () => {
        let parsed;
        try {
          parsed = JSON.parse(textarea.value);
        } catch (err) {
          setStatus(statusMsg, "JSONの形式が正しくありません。", true);
          return;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setStatus(statusMsg, "データの形式が正しくありません。", true);
          return;
        }
        const unknownKeys = Object.keys(parsed).filter((k) => !ALL_KEYS.includes(k));
        if (unknownKeys.length > 0) {
          setStatus(statusMsg, `未知のキーが含まれています: ${unknownKeys.join(", ")}`, true);
          return;
        }
        for (const key of ALL_KEYS) {
          if (key in parsed) set(key, parsed[key]);
        }
        setStatus(statusMsg, "インポートしました。反映のため画面を再読み込みします。", false);
        setTimeout(() => window.location.reload(), 800);
      },
    },
    "インポート"
  );
  btnRow.appendChild(copyBtn);
  btnRow.appendChild(importBtn);
  card.appendChild(btnRow);
  card.appendChild(statusMsg);

  return card;
}

function setStatus(el, message, isError) {
  el.textContent = message;
  el.classList.remove("is-hidden");
  el.classList.toggle("settings-import-status--error", !!isError);
}

function showToast(container, message) {
  const toast = el("div", { class: "toast" }, message);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}
