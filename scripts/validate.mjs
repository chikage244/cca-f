#!/usr/bin/env node
// Zero-dependency content + service-worker precache validator.
//
// Usage:
//   node scripts/validate.mjs          # schema/uniqueness/precache checks only
//   node scripts/validate.mjs --full   # also enforces the final per-domain
//                                       # question/flashcard counts (only
//                                       # true once all content has been
//                                       # generated; seed data will not pass)
//
// Exits with code 1 and a full list of errors on any failure.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FULL = process.argv.includes("--full");

const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

let questionsWithJaCount = 0;
let flashcardsWithJaCount = 0;

function readJson(relPath) {
  const abs = path.join(ROOT, relPath);
  const raw = readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

// ---------- Question domains ----------

const DOMAIN_FILES = [
  { domain: "agentic", file: "data/questions-agentic.json", fullCount: 81 },
  { domain: "claude-code", file: "data/questions-claude-code.json", fullCount: 60 },
  { domain: "prompting", file: "data/questions-prompting.json", fullCount: 60 },
  { domain: "mcp", file: "data/questions-mcp.json", fullCount: 54 },
  { domain: "context", file: "data/questions-context.json", fullCount: 45 },
];

const FLASHCARDS_FULL_COUNT = 100;

const allQuestionIds = new Map(); // id -> file it was first seen in

function validateQuestionFile({ domain, file, fullCount }) {
  const idPattern = new RegExp(`^${domain}-\\d{3}$`);
  let data;

  try {
    data = readJson(file);
  } catch (err) {
    fail(`${file}: failed to parse JSON (${err.message})`);
    return;
  }

  if (!Array.isArray(data)) {
    fail(`${file}: expected a top-level JSON array`);
    return;
  }

  data.forEach((item, index) => {
    const where = `${file}[${index}]`;

    if (!item || typeof item !== "object") {
      fail(`${where}: item is not an object`);
      return;
    }

    // id
    if (typeof item.id !== "string" || !idPattern.test(item.id)) {
      fail(`${where}: id "${item.id}" does not match /${idPattern.source}/`);
    } else {
      if (allQuestionIds.has(item.id)) {
        fail(`${where}: duplicate id "${item.id}" (first seen in ${allQuestionIds.get(item.id)})`);
      } else {
        allQuestionIds.set(item.id, file);
      }
    }

    // domain
    if (item.domain !== domain) {
      fail(`${where}: domain field "${item.domain}" does not match expected "${domain}"`);
    }

    // difficulty
    if (!Number.isInteger(item.difficulty) || item.difficulty < 1 || item.difficulty > 3) {
      fail(`${where}: difficulty "${item.difficulty}" must be an integer 1-3`);
    }

    // question
    if (typeof item.question !== "string" || item.question.trim().length === 0) {
      fail(`${where}: question must be a non-empty string`);
    }

    // choices
    if (!Array.isArray(item.choices) || item.choices.length !== 4) {
      fail(`${where}: choices must be an array of exactly 4 items`);
    } else {
      item.choices.forEach((choice, choiceIndex) => {
        if (typeof choice !== "string" || choice.trim().length === 0) {
          fail(`${where}: choices[${choiceIndex}] must be a non-empty string`);
        }
      });
    }

    // answer
    if (!Number.isInteger(item.answer) || item.answer < 0 || item.answer > 3) {
      fail(`${where}: answer "${item.answer}" must be an integer 0-3`);
    }

    // explanation
    if (typeof item.explanation !== "string" || item.explanation.trim().length === 0) {
      fail(`${where}: explanation must be a non-empty string`);
    }

    // tags
    if (!Array.isArray(item.tags)) {
      fail(`${where}: tags must be an array`);
    }

    // questionJa / choicesJa (optional translation fields; only validated
    // in --full mode, and only their shape IF present)
    if (FULL) {
      const hasQuestionJa = Object.prototype.hasOwnProperty.call(item, "questionJa");
      const hasChoicesJa = Object.prototype.hasOwnProperty.call(item, "choicesJa");

      if (hasQuestionJa) {
        if (typeof item.questionJa !== "string" || item.questionJa.trim().length === 0) {
          fail(`${where}: questionJa must be a non-empty string when present`);
        }
      }

      if (hasChoicesJa) {
        if (!Array.isArray(item.choicesJa) || item.choicesJa.length !== 4) {
          fail(`${where}: choicesJa must be an array of exactly 4 items when present`);
        } else {
          item.choicesJa.forEach((choiceJa, choiceIndex) => {
            if (typeof choiceJa !== "string" || choiceJa.trim().length === 0) {
              fail(`${where}: choicesJa[${choiceIndex}] must be a non-empty string`);
            }
          });
        }
      }

      if (hasQuestionJa || hasChoicesJa) questionsWithJaCount += 1;
    }
  });

  if (FULL && data.length !== fullCount) {
    fail(`${file}: expected exactly ${fullCount} questions in --full mode, found ${data.length}`);
  }
}

DOMAIN_FILES.forEach(validateQuestionFile);

// ---------- Flashcards ----------

function validateFlashcards() {
  const file = "data/flashcards.json";
  let data;

  try {
    data = readJson(file);
  } catch (err) {
    fail(`${file}: failed to parse JSON (${err.message})`);
    return;
  }

  if (!Array.isArray(data)) {
    fail(`${file}: expected a top-level JSON array`);
    return;
  }

  const validDomains = new Set(DOMAIN_FILES.map((d) => d.domain));
  const seenIds = new Set();
  const idPattern = /^fc-([a-z-]+)-\d{3}$/;

  data.forEach((item, index) => {
    const where = `${file}[${index}]`;

    if (!item || typeof item !== "object") {
      fail(`${where}: item is not an object`);
      return;
    }

    const match = typeof item.id === "string" ? item.id.match(idPattern) : null;
    if (!match) {
      fail(`${where}: id "${item.id}" does not match /^fc-<domain>-\\d{3}$/`);
    } else {
      const [, idDomain] = match;
      if (!validDomains.has(idDomain)) {
        fail(`${where}: id "${item.id}" references unknown domain "${idDomain}"`);
      }
      if (item.domain !== idDomain) {
        fail(`${where}: domain field "${item.domain}" does not match domain in id "${idDomain}"`);
      }
      if (seenIds.has(item.id)) {
        fail(`${where}: duplicate flashcard id "${item.id}"`);
      } else {
        seenIds.add(item.id);
      }
    }

    if (typeof item.term !== "string" || item.term.trim().length === 0) {
      fail(`${where}: term must be a non-empty string`);
    }

    if (typeof item.definition !== "string" || item.definition.trim().length === 0) {
      fail(`${where}: definition must be a non-empty string`);
    }

    // termJa (optional translation field; only validated in --full mode)
    if (FULL && Object.prototype.hasOwnProperty.call(item, "termJa")) {
      if (typeof item.termJa !== "string" || item.termJa.trim().length === 0) {
        fail(`${where}: termJa must be a non-empty string when present`);
      } else {
        flashcardsWithJaCount += 1;
      }
    }
  });

  if (FULL && data.length !== FLASHCARDS_FULL_COUNT) {
    fail(`${file}: expected exactly ${FLASHCARDS_FULL_COUNT} flashcards in --full mode, found ${data.length}`);
  }
}

validateFlashcards();

// ---------- Service worker precache cross-check ----------

function listFilesRecursive(dir, exts) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      results.push(...listFilesRecursive(abs, exts));
    } else if (!exts || exts.includes(path.extname(entry))) {
      results.push(abs);
    }
  }
  return results;
}

function toRelUrl(absPath) {
  const rel = path.relative(ROOT, absPath).split(path.sep).join("/");
  return `./${rel}`;
}

function validatePrecache() {
  const swPath = path.join(ROOT, "sw.js");
  if (!existsSync(swPath)) {
    fail("sw.js: file not found at repo root");
    return;
  }

  const swSource = readFileSync(swPath, "utf8");
  const match = swSource.match(/PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/);
  if (!match) {
    fail("sw.js: could not locate a PRECACHE_URLS array literal");
    return;
  }

  const listed = [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  const listedSet = new Set(listed);

  // Direction 1: every listed file must exist on disk (except "./" which is
  // the navigation request for index.html, already covered separately).
  for (const url of listed) {
    if (url === "./") continue;
    const rel = url.replace(/^\.\//, "");
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) {
      fail(`sw.js PRECACHE_URLS: listed file "${url}" does not exist on disk`);
    }
  }

  // Direction 2: every shippable js/data/css/icon file on disk must be listed.
  const mustBeListed = [
    ...listFilesRecursive(path.join(ROOT, "js"), [".js"]),
    ...listFilesRecursive(path.join(ROOT, "data"), [".json"]),
    ...listFilesRecursive(path.join(ROOT, "css"), [".css"]),
    ...listFilesRecursive(path.join(ROOT, "icons"), [".png", ".ico", ".svg"]),
    path.join(ROOT, "index.html"),
    path.join(ROOT, "manifest.webmanifest"),
  ];

  for (const abs of mustBeListed) {
    const relUrl = toRelUrl(abs);
    if (!listedSet.has(relUrl)) {
      fail(`sw.js PRECACHE_URLS: missing entry for existing file "${relUrl}"`);
    }
  }
}

validatePrecache();

// ---------- Ja translation coverage (informational, --full only) ----------

if (FULL) {
  if (questionsWithJaCount === 0) {
    warn("no questions have questionJa/choicesJa yet (translation may still be in progress)");
  }
  if (flashcardsWithJaCount === 0) {
    warn("no flashcards have termJa yet (translation may still be in progress)");
  }
}

// ---------- Report ----------

if (warnings.length > 0) {
  console.warn(`\nvalidate.mjs: ${warnings.length} warning(s)${FULL ? " (--full mode)" : ""}:\n`);
  for (const w of warnings) {
    console.warn(`  - ${w}`);
  }
  console.warn("");
}

if (errors.length > 0) {
  console.error(`\nvalidate.mjs: ${errors.length} error(s) found${FULL ? " (--full mode)" : ""}:\n`);
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  console.error("");
  process.exit(1);
}

console.log(`validate.mjs: all checks passed${FULL ? " (--full mode)" : ""}.`);
