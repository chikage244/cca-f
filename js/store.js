// localStorage wrapper: owns the "ccaf.v1." key namespace.
// All access is try/catch-wrapped (Safari private mode throws on write/quota).

const PREFIX = "ccaf.v1.";
const SCHEMA_VERSION = 1;
const META_KEY = "__meta__";

function fullKey(key) {
  return `${PREFIX}${key}`;
}

/**
 * Read a value from localStorage under the ccaf.v1. namespace.
 * @param {string} key
 * @param {*} fallback
 * @returns {*}
 */
export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(fullKey(key));
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

/**
 * Write a value to localStorage under the ccaf.v1. namespace.
 * @param {string} key
 * @param {*} value
 * @returns {boolean} true if the write succeeded
 */
export function set(key, value) {
  try {
    localStorage.setItem(fullKey(key), JSON.stringify(value));
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Remove a key from localStorage under the ccaf.v1. namespace.
 * @param {string} key
 * @returns {boolean} true if the removal succeeded
 */
export function remove(key) {
  try {
    localStorage.removeItem(fullKey(key));
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Boot-time schema guard. If a previous, incompatible schema version is
 * detected, this is where a migration or reset would be triggered.
 * Safe to call multiple times; only acts once per session load.
 */
export function ensureSchema() {
  try {
    const meta = get(META_KEY, null);
    if (!meta || meta.schemaVersion !== SCHEMA_VERSION) {
      // No migrations defined yet (schema v1 is the first version).
      set(META_KEY, { schemaVersion: SCHEMA_VERSION });
    }
  } catch (err) {
    // localStorage entirely unavailable; app continues in-memory only.
  }
}
