// Copyright 2026 OpenObserve Inc.
//
// Free-text search for the LLM Sessions list.
//
// The sessions list is server-paginated, so search cannot be a client-side
// filter over the loaded page — it has to reach the backend. The sessions
// endpoint (`GET /api/{org}/{stream}/traces/session`) already accepts a
// `filter` predicate that it splices into the session-membership HAVING clause
// (`max(CASE WHEN <filter> THEN 1 ELSE 0 END) = 1`), which is the same channel
// the agent scope filter rides. Search therefore builds another span-level
// predicate and is ANDed onto that one.

/** Escape a value for embedding in a single-quoted SQL literal. */
function sqlQuote(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Build the span-level predicate for a Sessions search term.
 *
 * Matches the session id and the user id, case-insensitively, using
 * OpenObserve's `str_match_ignore_case` UDF (the same "contains" primitive the
 * traces query syntax exposes). Returns the bare predicate with no leading
 * `AND`/`WHERE`, or an empty string when there is nothing to search for.
 *
 * Column names are the canonical gen_ai ones, matching the rest of this page —
 * the agent filter and the session-detail queries already assume that schema.
 *
 * @example
 *   buildSessionSearchFilter("acme")
 *   // (str_match_ignore_case(gen_ai_conversation_id, 'acme')
 *   //  OR str_match_ignore_case(user_id, 'acme'))
 */
export function buildSessionSearchFilter(query: string): string {
  const term = (query || "").trim();
  if (!term) return "";
  const value = sqlQuote(term);
  return (
    `(str_match_ignore_case(gen_ai_conversation_id, '${value}')` +
    ` OR str_match_ignore_case(user_id, '${value}'))`
  );
}

/**
 * AND together the scope predicates that make up the sessions `filter` param,
 * dropping empty ones and parenthesising each so precedence can't leak between
 * them. Returns "" when nothing is active (the endpoint then skips the HAVING
 * clause entirely).
 */
export function combineSessionFilters(...clauses: string[]): string {
  const parts = clauses.map((c) => (c || "").trim()).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return parts.map((c) => `(${c})`).join(" AND ");
}
