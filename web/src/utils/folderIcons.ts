// Copyright 2026 OpenObserve Inc.
//
// Name -> emoji suggestion for folders. Pure and deterministic: the same name
// always yields the same emoji, so a folder's auto-picked icon never drifts
// between sessions or between users.

import { ALL_EMOJIS } from "@/lib/forms/EmojiPicker/emojiCatalog";

/**
 * Neutral, folder-ish emojis used when a name matches no keyword. Picking from
 * a small curated pool (rather than the whole catalog) keeps the fallback from
 * putting something absurd next to "Team Notes".
 */
const FALLBACK_POOL = ["📁", "🗂️", "🗃️", "📦", "🧩", "🏷️", "📌", "🧰", "📐", "💼"] as const;

/** Words too generic to carry a signal — matching on them yields noise. */
const STOP_WORDS = new Set(["the", "and", "for", "new", "all", "my", "our", "a", "an", "of"]);

/** Distinct, meaningful words in a name. Deduped so "prod prod" isn't 2x. */
function tokenize(name: string): string[] {
  return [
    ...new Set(
      name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 0 && !STOP_WORDS.has(token)),
    ),
  ];
}

/**
 * How strongly one name token matches one keyword. Higher is better; 0 means no
 * match. Length floors keep short tokens from matching half the catalog.
 */
function scoreToken(token: string, keyword: string): number {
  if (token === keyword) return 4;
  if (token.length >= 3 && keyword.startsWith(token)) return 3;
  if (keyword.length >= 4 && token.startsWith(keyword)) return 2;
  if (keyword.length >= 5 && token.includes(keyword)) return 1;
  return 0;
}

/** FNV-1a — a small stable hash so the fallback is per-name, not per-session. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Best emoji for a folder name. Returns null only for an effectively empty
 * name — anything else always gets an icon, so a folder is never blank while
 * the user is still typing.
 */
export function suggestFolderIcon(name: string): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;

  const tokens = tokenize(trimmed);
  let best = { emoji: "", score: 0 };

  // Scores SUM across distinct tokens (taking each token's best keyword), so an
  // emoji matched by two words of the name beats one matched by a single word:
  // "Kubernetes Cluster Alerts" is about Kubernetes, not about alerts. Catalog
  // order breaks genuine ties.
  for (const option of ALL_EMOJIS) {
    let score = 0;
    for (const token of tokens) {
      let bestForToken = 0;
      for (const keyword of option.keywords) {
        bestForToken = Math.max(bestForToken, scoreToken(token, keyword));
      }
      score += bestForToken;
    }
    if (score > best.score) best = { emoji: option.token, score };
  }

  if (best.score > 0) return best.emoji;
  return FALLBACK_POOL[hash(trimmed.toLowerCase()) % FALLBACK_POOL.length];
}
