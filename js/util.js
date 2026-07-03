// General-purpose helpers shared across the app.

/**
 * Fisher-Yates shuffle. Returns a NEW array; does not mutate the input.
 * @param {Array} arr
 * @returns {Array}
 */
export function shuffle(arr) {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Sample n items from arr without replacement. Returns a NEW array.
 * If n >= arr.length, returns a shuffled copy of the whole array.
 * @param {Array} arr
 * @param {number} n
 * @returns {Array}
 */
export function sampleWithoutReplacement(arr, n) {
  if (n >= arr.length) return shuffle(arr);
  return shuffle(arr).slice(0, n);
}

/**
 * Today's date as a local YYYY-MM-DD string (not UTC).
 * @returns {string}
 */
export function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Format seconds as "H:MM:SS" (when >= 1 hour) or "MM:SS" otherwise.
 * @param {number} sec
 * @returns {string}
 */
export function formatTime(sec) {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Small DOM element helper.
 * @param {string} tag
 * @param {Object} [attrs]
 * @param {Array|string|Node} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class" || key === "className") {
      node.className = value;
    } else if (key === "dataset") {
      for (const [dk, dv] of Object.entries(value)) node.dataset[dk] = dv;
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "html") {
      node.innerHTML = value;
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, value);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child == null || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
