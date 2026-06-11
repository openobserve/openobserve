// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * SQL diagnostics — contextual error messages for the Monaco editor.
 *
 * Approach (inspired by dt-sql-parser / monaco-sql-languages):
 *   Instead of scanning the text before the error cursor, we classify errors
 *   purely by the `expected` token set and `found` value that the PEG parser
 *   gives us. Each error type has a unique fingerprint in the `expected` set
 *   (e.g. only `[BY]` expected → incomplete ORDER/GROUP), so we can produce
 *   precise messages without any backward text analysis.
 *
 * Template system (same pattern as dt-sql-parser i18n):
 *   buildContextualSqlMessage() returns a string. The message templates are
 *   kept as constants so they can be extended or localised without touching
 *   the classifier logic.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SqlErrorRange {
  startLine: number;
  endLine: number;
  column?: number;
  error: string;
}

// ─── Message templates ────────────────────────────────────────────────────────
// Keep messages here so they are easy to update in one place.

const MSG = {
  // EOF / incomplete
  incompleteAnd:        "Incomplete condition — expected an expression after AND",
  incompleteOr:         "Incomplete condition — expected an expression after OR",
  incompleteNot:        "Incomplete condition — expected an expression after NOT",
  incompleteLike:       "Incomplete LIKE — expected a pattern string, e.g. LIKE '%value%'",
  incompleteIn:         "Incomplete IN — expected a value list, e.g. IN (1, 2, 3) or IN (SELECT …)",
  incompleteBetween:    "Incomplete BETWEEN — expected a range, e.g. BETWEEN 1 AND 10",
  incompleteIs:         "Incomplete IS — expected NULL, NOT NULL, TRUE, or FALSE after IS",
  incompleteOrderBy:    "Incomplete ORDER BY — expected a column name or expression",
  incompleteOrder:      "Incomplete ORDER — expected BY after ORDER",
  incompleteGroupBy:    "Incomplete GROUP BY — expected a column name or expression",
  incompleteGroup:      "Incomplete GROUP — expected BY after GROUP",
  incompleteHaving:     "Incomplete HAVING — expected a condition after HAVING",
  incompleteWhere:      "Incomplete WHERE — expected a condition after WHERE",
  incompleteFrom:       "Incomplete FROM — expected a table or stream name",
  incompleteSelect:     "Incomplete SELECT — expected column names, expressions, or *",
  incompleteComparison: (op: string) => `Incomplete comparison — expected a value after ${op}`,
  incompleteLimit:      "Incomplete LIMIT — expected a number",
  incompleteOffset:     "Incomplete OFFSET — expected a number",
  incompleteOpenParen:  "Unclosed parenthesis — expected an expression or closing )",
  incompleteExpr:       "Unexpected end of query — the expression is incomplete",

  // Unexpected token
  missingWhere:     (col: string) => `Missing WHERE keyword — did you mean: … FROM … WHERE ${col} = …?`,
  missingOperator:  (word: string) => `Missing operator before '${word}' — did you forget AND or OR?`,
  unexpectedIdent:  (word: string) => `Unexpected '${word}' — did you forget AND, OR, or an operator?`,
  badLikePattern:   "Invalid LIKE pattern — wrap the pattern in single quotes, e.g. LIKE '%value%'",
  unexpectedClose:  "Unexpected closing parenthesis ) — check that every ( has a matching )",
  unexpectedComma:  (line: number, col: number) => `Unexpected comma at line ${line}, column ${col} — check your column list or function arguments`,
  generic:          (ch: string, line: number, col: number) => `Unexpected '${ch}' at line ${line}, column ${col}`,
} as const;

// ─── Expected-set classifier ──────────────────────────────────────────────────

/** Extract unique uppercased literal tokens from the PEG `expected` array. */
function expectedLiterals(expected: any[]): Set<string> {
  const s = new Set<string>();
  for (const e of expected) {
    if (e.type === "literal" && e.text) s.add(e.text.toUpperCase());
  }
  return s;
}

function has(set: Set<string>, ...keys: string[]): boolean {
  return keys.some((k) => set.has(k));
}

// ─── Core message builder ─────────────────────────────────────────────────────

/**
 * Convert a PEG SyntaxError from @openobserve/node-sql-parser into a
 * human-readable diagnostic message.
 *
 * Classification is driven entirely by `err.expected` and `err.found` —
 * no backward text scanning. This mirrors the dt-sql-parser approach of
 * using the parser's own token-set output rather than heuristic regex.
 *
 * @param sql  The full SQL string that was parsed (used only to extract the
 *             full word at the error offset for display purposes).
 * @param err  The SyntaxError thrown by node-sql-parser.
 */
export function buildContextualSqlMessage(sql: string, err: any): string {
  const loc = err?.location?.start;
  if (!loc) return err?.message?.split("\n")[0] ?? "SQL syntax error";

  const offset: number = loc.offset;
  const found: string | null = err.found ?? null;
  const exp: Set<string> = expectedLiterals(err.expected ?? []);
  const expSize: number = err.expected?.length ?? 0;

  // Helper: last meaningful keyword before the error.
  // Strips leading "(" so "(ORDER" → "ORDER" for OVER clause handling.
  // Returns "(" itself when the raw token is purely parentheses (open-paren context).
  const lastWord = (o = offset) => {
    const raw = sql.substring(0, o).trimEnd().split(/\s+/).pop() ?? "";
    const stripped = raw.replace(/^\(*/, "").toUpperCase();
    return stripped || (raw.startsWith("(") ? "(" : "");
  };

  // ── EOF errors (found === null) ─────────────────────────────────────────────
  if (found === null) {
    // ORDER/GROUP incomplete: only [BY] (+ comment/whitespace tokens) expected
    // Also catches expSize === 0 or 1 (nothing expected → query ended mid-keyword)
    if ((has(exp, "BY") && expSize <= 10) || expSize <= 1) {
      // Determine whether it was ORDER or GROUP from the last token before EOF
      const lw = lastWord();
      if (lw === "ORDER") return MSG.incompleteOrder;
      if (lw === "GROUP") return MSG.incompleteGroup;
      // Already have BY (e.g. "ORDER BY") — need a column
      const prev2 = sql.substring(0, offset).trimEnd().split(/\s+/).slice(-2).map(t => t.toUpperCase());
      if (prev2.includes("ORDER")) return MSG.incompleteOrderBy;
      if (prev2.includes("GROUP")) return MSG.incompleteGroupBy;
      return MSG.incompleteExpr;
    }

    // LIMIT/OFFSET incomplete: expected has number/sign tokens but no SQL keywords
    if (!has(exp, "AND", "OR", "NOT", "BY", "WHERE", "HAVING", "FROM", "SELECT", "NULL", "TRUE", "FALSE")) {
      const lw = lastWord();
      if (lw === "LIMIT")  return MSG.incompleteLimit;
      if (lw === "OFFSET") return MSG.incompleteOffset;
    }

    // Expression expected (WHERE / HAVING / AND / OR / NOT / GROUP BY / open paren / after operator)
    if (has(exp, "NOT", "NULL", "TRUE", "FALSE") && has(exp, "SELECT")) {
      const lw = lastWord();
      switch (lw) {
        case "AND":    return MSG.incompleteAnd;
        case "OR":     return MSG.incompleteOr;
        case "NOT":    return MSG.incompleteNot;
        case "WHERE":  return MSG.incompleteWhere;
        case "HAVING": return MSG.incompleteHaving;
        case "(":      return MSG.incompleteOpenParen;
        default: {
          const tokens = sql.substring(0, offset).trimEnd().split(/\s+/).filter(Boolean);
          const last = tokens[tokens.length - 1]?.replace(/^\(*/, "").toUpperCase() ?? "";
          const prev = tokens[tokens.length - 2]?.replace(/^\(*/, "").toUpperCase() ?? "";
          if (last === "BY" && prev === "GROUP") return MSG.incompleteGroupBy;
          if (last === "BY" && prev === "ORDER") return MSG.incompleteOrderBy;
          if (last === "(" ) return MSG.incompleteOpenParen;
          return MSG.incompleteExpr;
        }
      }
    }

    // LIKE/ILIKE: expected contains quoted-string tokens but not AND/OR
    if (!has(exp, "AND", "OR") && has(exp, "NULL", "TRUE", "FALSE") && !has(exp, "SELECT")) {
      const lw = lastWord();
      if (["LIKE", "ILIKE", "RLIKE", "NOT"].includes(lw)) return MSG.incompleteLike;
      if (["=", "!=", "<>", "<", ">", "<=", ">="].includes(lw)) return MSG.incompleteComparison(lw);
      if (lw === "IS")      return MSG.incompleteIs;
      if (lw === "BETWEEN") return MSG.incompleteBetween;
    }

    // IN incomplete: expected contains "(" and function names but not AND/OR/NOT
    if (!has(exp, "AND", "OR", "NOT", "NULL", "TRUE", "FALSE", "SELECT") && has(exp, "(")) {
      const lw = lastWord();
      if (lw === "IN" || lw === "NOT") return MSG.incompleteIn;
    }

    // FROM incomplete
    if (!has(exp, "AND", "OR", "NOT", "WHERE", "HAVING") && expSize > 10 && expSize < 80) {
      const lw = lastWord();
      if (lw === "FROM") return MSG.incompleteFrom;
    }

    // SELECT incomplete (very few expected: = ; . TO etc)
    if (expSize < 20 && has(exp, "=") && !has(exp, "FROM", "WHERE", "AND", "OR")) {
      return MSG.incompleteSelect;
    }

    return MSG.incompleteExpr;
  }

  // ── Unexpected token errors (found !== null) ────────────────────────────────

  // Extract full word at error position (PEG only gives first char in `found`)
  const wordAtError =
    sql.substring(offset).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/)?.[0] ??
    found;

  // found "=" or an identifier/operator with WHERE in expected → missing WHERE keyword
  // Covers: "FROM t col = val" (found="=") and "FROM t col IS NULL" (found="I" for IS)
  if (has(exp, "WHERE", "HAVING", "LIMIT") && !has(exp, "AND", "OR")) {
    const colName = (sql.substring(0, offset).trimEnd().split(/\s+/).pop() ?? wordAtError).replace(/^\(*/, "");
    return MSG.missingWhere(colName);
  }

  // found identifier, AND/OR operators in expected → missing AND/OR between conditions
  if (/^[a-zA-Z_$]/.test(found) && has(exp, "AND", "OR")) {
    // Check char before error: if it ends a value (quote, digit, paren) → missing operator
    const charBeforeError = sql.substring(0, offset).trimEnd().slice(-1);
    if (["'", '"', ")", "0","1","2","3","4","5","6","7","8","9"].includes(charBeforeError)) {
      return MSG.missingOperator(wordAtError);
    }
    return MSG.unexpectedIdent(wordAtError);
  }

  // found "%" → unquoted LIKE pattern
  if (found === "%") return MSG.badLikePattern;

  // found ")" unexpectedly
  if (found === ")") return MSG.unexpectedClose;

  // found ","
  if (found === ",") return MSG.unexpectedComma(loc.line, loc.column);

  // Generic fallback
  return MSG.generic(found, loc.line, loc.column);
}

// ─── Parser-limitation guards ─────────────────────────────────────────────────

/**
 * Check if a PEG SyntaxError is a parser limitation rather than a real
 * user mistake.  The client parser doesn't support every construct the
 * OpenObserve backend accepts (e.g. PERCENT_RANK() OVER, CUME_DIST() OVER,
 * POSITION(str IN str), or complex window function clauses).
 *
 * When this returns true the caller should treat the SQL as valid — the
 * backend will parse it correctly.
 *
 * This is a pure function of the error object — no async imports needed,
 * so it can be used in both sync and async validation paths.
 */
export function isParserLimitation(err: any): boolean {
  // Guard 1: found is a whitespace character (never a real user error)
  if (err?.found != null && /^\s$/.test(err.found)) return true;

  const expLits = new Set(
    (err?.expected ?? [])
      .filter((e: any) => e.type === "literal")
      .map((e: any) => e.text?.toUpperCase()),
  );
  const expSize: number = err?.expected?.length ?? 0;

  // Guard 2: found is a letter AND expected contains both ")" and "AND"/"OR"
  // with a very large candidate set (parser gave up inside a complex expression)
  if (
    err?.found != null &&
    /^[a-zA-Z]$/.test(err.found) &&
    expLits.has(")") &&
    (expLits.has("AND") || expLits.has("OR")) &&
    expSize > 150
  )
    return true;

  // Guard 3: POSITION(str IN str) syntax — parser doesn't support it,
  // found=")" with small expected set
  if (
    err?.found === ")" &&
    !expLits.has(")") &&
    !expLits.has("AND") &&
    !expLits.has("OR") &&
    expSize < 50
  )
    return true;

  // Guard 4: found "(" inside a window function clause where ORDER/ROWS
  // are expected. The parser cannot handle complex window function arguments
  // like SUM(COUNT(*)) OVER (...) or NTILE(N) OVER (PARTITION BY COALESCE(...) ...).
  if (
    err?.found === "(" &&
    expLits.has("ORDER") &&
    expLits.has("ROWS") &&
    !expLits.has("AND") &&
    !expLits.has("OR")
  )
    return true;

  return false;
}

// ─── Async validator ──────────────────────────────────────────────────────────

let _parserInstance: any = null;

async function getParser(): Promise<any> {
  if (_parserInstance) return _parserInstance;
  const mod = await import("@openobserve/node-sql-parser/build/datafusionsql");
  _parserInstance = new ((mod as any).default?.Parser ?? (mod as any).Parser)();
  return _parserInstance;
}

/**
 * Run a client-side syntax check on a SQL string.
 * Returns `null` if valid, or an `SqlErrorRange` with a contextual message.
 *
 * @param sql         Full SQL to validate.
 * @param colOffset   Subtract this from the error column so the squiggle
 *                    points into the user's filter text rather than a
 *                    constructed SQL prefix. Pass 0 for SQL mode.
 */
export async function validateSql(
  sql: string,
  _lineOffset = 0,
  colOffset = 0,
): Promise<SqlErrorRange | null> {
  const parser = await getParser();
  try {
    parser.astify(sql);
    return null;
  } catch (err: any) {
    // Suppress parser limitations — these are known gaps in the PEG parser
    // that the DataFusion backend handles correctly.
    if (isParserLimitation(err)) return null;

    const loc = err?.location?.start;
    const line = Math.max(1, (loc?.line ?? 1));
    const col = Math.max(1, (loc?.column ?? 1) - colOffset);
    const msg = buildContextualSqlMessage(sql, err);
    return { startLine: line, endLine: line, column: col, error: msg };
  }
}

// ─── Server-error range extractors ───────────────────────────────────────────

/**
 * SQL mode server error (code 20001): detail is
 * "sql parser error: … at Line: N, Column: M"
 * Re-run client parser on the original SQL for a contextual message.
 */
export async function rangesFromSqlParserDetail(
  detail: string,
  originalSql?: string,
): Promise<SqlErrorRange[]> {
  const locMatch = detail.match(/at\s+Line:\s*(\d+),\s*Column:\s*(\d+)/i);
  if (!locMatch) return [];

  const line = parseInt(locMatch[1], 10);
  const col = parseInt(locMatch[2], 10);

  if (originalSql) {
    const range = await validateSql(originalSql);
    // Client parser found a real syntax error — use its contextual message
    if (range) return [range];
    // Client parser accepted the SQL — the server error is semantic (unknown column,
    // type mismatch, etc.) not a parse error we can point to. Don't show a squiggle.
    return [];
  }

  const msg = detail
    .replace(/\s*at\s+Line:\s*\d+,\s*Column:\s*\d+/i, "")
    .replace(/^sql parser error:\s*/i, "")
    .trim();

  return [{ startLine: line, endLine: line, column: col, error: msg }];
}

/**
 * Non-SQL mode server error: message contains
 * "Error# SQL error: ParserError(\"… at Line: 1, Column: N\")"
 * Re-run client parser on the constructed SQL for exact position + contextual message.
 *
 * @param constructedSql  Full SQL sent to server (select … from "stream" WHERE <filter>).
 * @param colOffset       Length of the SQL prefix before the user's filter text.
 */
export async function rangesFromServerMessage(
  message: string,
  constructedSql?: string,
  colOffset = 0,
): Promise<SqlErrorRange[]> {
  if (constructedSql) {
    const range = await validateSql(constructedSql, 0, colOffset);
    if (range) return [range];
  }

  // Fallback: extract message from ParserError wrapper, highlight line 1
  const parserMatch = message.match(/ParserError\("(.+?)"\)/i);
  const fallbackMsg = parserMatch
    ? parserMatch[1].replace(/\s*at\s+Line:\s*\d+,\s*Column:\s*\d+/i, "").trim()
    : message.replace(/^Error#\s*/i, "").trim();

  return [{ startLine: 1, endLine: 1, column: 1, error: fallbackMsg }];
}
