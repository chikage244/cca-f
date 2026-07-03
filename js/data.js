// Domain metadata and question/flashcard loaders (with in-memory cache).

export const DOMAINS = [
  {
    id: "agentic",
    nameJa: "エージェント型アーキテクチャ",
    weight: 0.27,
    examCount: 16,
    file: "questions-agentic.json",
  },
  {
    id: "claude-code",
    nameJa: "Claude Code",
    weight: 0.2,
    examCount: 12,
    file: "questions-claude-code.json",
  },
  {
    id: "prompting",
    nameJa: "プロンプトエンジニアリング",
    weight: 0.2,
    examCount: 12,
    file: "questions-prompting.json",
  },
  {
    id: "mcp",
    nameJa: "ツール設計 & MCP",
    weight: 0.18,
    examCount: 11,
    file: "questions-mcp.json",
  },
  {
    id: "context",
    nameJa: "コンテキスト管理",
    weight: 0.15,
    examCount: 9,
    file: "questions-context.json",
  },
];

const questionCache = new Map();
let allQuestionsCache = null;
let flashcardsCache = null;

/**
 * Load questions for a single domain (in-memory cached).
 * @param {string} domainId
 * @returns {Promise<Array>}
 */
export async function loadQuestions(domainId) {
  if (questionCache.has(domainId)) return questionCache.get(domainId);
  const domain = DOMAINS.find((d) => d.id === domainId);
  if (!domain) throw new Error(`Unknown domain: ${domainId}`);
  const res = await fetch(`./data/${domain.file}`);
  if (!res.ok) throw new Error(`Failed to load questions for ${domainId}: ${res.status}`);
  const questions = await res.json();
  questionCache.set(domainId, questions);
  return questions;
}

/**
 * Load all questions across all domains (in-memory cached).
 * @returns {Promise<Array>}
 */
export async function loadAllQuestions() {
  if (allQuestionsCache) return allQuestionsCache;
  const lists = await Promise.all(DOMAINS.map((d) => loadQuestions(d.id)));
  allQuestionsCache = lists.flat();
  return allQuestionsCache;
}

/**
 * Load all flashcards (in-memory cached).
 * @returns {Promise<Array>}
 */
export async function loadFlashcards() {
  if (flashcardsCache) return flashcardsCache;
  const res = await fetch("./data/flashcards.json");
  if (!res.ok) throw new Error(`Failed to load flashcards: ${res.status}`);
  flashcardsCache = await res.json();
  return flashcardsCache;
}
