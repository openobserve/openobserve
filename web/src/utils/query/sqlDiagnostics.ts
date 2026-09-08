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
 * Suppression model (allow-list, not deny-list):
 *   validateSql returns an error ONLY when buildContextualSqlMessage produces a
 *   positively-classified message — i.e. one that names the specific problem.
 *   Unrecognised error shapes (MSG.generic, MSG.incompleteExpr from an unknown
 *   fingerprint) are treated as parser-limitation false positives and suppressed.
 *   This means every gap between the client PEG grammar and the DataFusion backend
 *   defaults to "silent" rather than "wrong squiggle".
 *
 * Classification approach (inspired by dt-sql-parser / monaco-sql-languages):
 *   Errors are classified by the `expected` token set and `found` value from the
 *   PEG parser, supplemented by a backward context scanner for nested constructs
 *   (CASE, COALESCE, OVER, CTE, subquery). No forward regex on user text.
 *
 * Template system (same pattern as dt-sql-parser i18n):
 *   buildContextualSqlMessage() returns a string. The message templates are
 *   kept as constants so they can be extended or localised without touching
 *   the classifier logic.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

import { gt, raw, type I18nText } from "@/types/i18n";
import { maxParenDepth, SQL_PARSE_MAX_DEPTH } from "@/utils/query/sqlComplexity";

export interface SqlErrorRange {
  startLine: number;
  endLine: number;
  column?: number;
  /**
   * Optional 1-based end column. When set, the editor squiggles only from
   * `column` to `endColumn` (used to wrap a single offending token — e.g. an
   * unknown field name). When omitted, the editor highlights to end-of-line,
   * which is the right behaviour for syntax errors near the cursor.
   */
  endColumn?: number;
  error: string;
}

// ─── Message templates ────────────────────────────────────────────────────────
// Keep messages here so they are easy to update in one place.

// Memoised: these getters sit on the hot path (validateSql runs per keystroke and
// per query in bulk callers), and vue-i18n resolution is not free. A locale change
// triggers window.location.reload(), so a per-session cache can never go stale.
const _msgCache = new Map<string, I18nText>();
const m = (key: string): I18nText => {
  let v = _msgCache.get(key);
  if (v === undefined) {
    v = gt(key);
    _msgCache.set(key, v);
  }
  return v;
};

// Parameterised sibling of `m`, and it has to be memoised for the same reason:
// a `gt` call costs ~0.2ms on this instance, and the messages below are built
// on the classifier's main path — including for errors that are then
// suppressed — so resolving one per call put the spec back over its 5s budget.
//
// The result varies with the values, so what is cached is the RESOLVED LAYOUT
// rather than the text: `gt` runs once per key with every placeholder fed a
// unique sentinel, and splitting on those sentinels recovers the literal
// segments plus the order the placeholders appear in. vue-i18n still owns
// lookup, fallback and compilation; only the substitution of the values is
// ours, so a locale that reorders or repeats a placeholder is still honoured.
//
// Assumes a key is always called with the same set of placeholder names, which
// is true by construction: each MSG entry below owns exactly one key.
const SENTINEL = "\u0000";
const _tmplCache = new Map<string, string[]>();

const mi = (key: string, named: Record<string, unknown>): I18nText => {
  let parts = _tmplCache.get(key);
  if (parts === undefined) {
    const probes: Record<string, string> = {};
    for (const name of Object.keys(named)) probes[name] = `${SENTINEL}${name}${SENTINEL}`;
    // Even indices are literal text, odd indices are placeholder names.
    parts = gt(key, probes).split(SENTINEL);
    _tmplCache.set(key, parts);
  }
  let text = "";
  for (let i = 0; i < parts.length; i++) {
    text += i % 2 === 0 ? parts[i] : String(named[parts[i]] ?? "");
  }
  // `raw` is used purely as the cast-free way to re-brand text that vue-i18n
  // already resolved above — this is translated output, not an exemption.
  return raw(text);
};

const MSG = {
  // EOF / incomplete
  get incompleteAnd() {
    return m("sqlEditor.diagnostics.incompleteAnd");
  },
  get incompleteOr() {
    return m("sqlEditor.diagnostics.incompleteOr");
  },
  get incompleteNot() {
    return m("sqlEditor.diagnostics.incompleteNot");
  },
  get incompleteLike() {
    return m("sqlEditor.diagnostics.incompleteLike");
  },
  get incompleteIn() {
    return m("sqlEditor.diagnostics.incompleteIn");
  },
  get incompleteBetween() {
    return m("sqlEditor.diagnostics.incompleteBetween");
  },
  get incompleteIs() {
    return m("sqlEditor.diagnostics.incompleteIs");
  },
  get incompleteOrderBy() {
    return m("sqlEditor.diagnostics.incompleteOrderBy");
  },
  get incompleteOrder() {
    return m("sqlEditor.diagnostics.incompleteOrder");
  },
  get incompleteGroupBy() {
    return m("sqlEditor.diagnostics.incompleteGroupBy");
  },
  get incompleteGroup() {
    return m("sqlEditor.diagnostics.incompleteGroup");
  },
  get incompleteHaving() {
    return m("sqlEditor.diagnostics.incompleteHaving");
  },
  get incompleteWhere() {
    return m("sqlEditor.diagnostics.incompleteWhere");
  },
  get incompleteFrom() {
    return m("sqlEditor.diagnostics.incompleteFrom");
  },
  get incompleteSelect() {
    return m("sqlEditor.diagnostics.incompleteSelect");
  },
  incompleteComparison: (op: string) => mi("sqlEditor.diagnostics.incompleteComparison", { op }),
  get incompleteLimit() {
    return m("sqlEditor.diagnostics.incompleteLimit");
  },
  get incompleteOffset() {
    return m("sqlEditor.diagnostics.incompleteOffset");
  },
  get incompleteOpenParen() {
    return m("sqlEditor.diagnostics.incompleteOpenParen");
  },
  get incompleteExpr() {
    return m("sqlEditor.diagnostics.incompleteExpr");
  },

  // UNION / JOIN / DISTINCT
  get incompleteUnion() {
    return m("sqlEditor.diagnostics.incompleteUnion");
  },
  get incompleteJoinOn() {
    return m("sqlEditor.diagnostics.incompleteJoinOn");
  },
  get incompleteDistinct() {
    return m("sqlEditor.diagnostics.incompleteDistinct");
  },

  // Unexpected token
  missingWhere: (col: string) => mi("sqlEditor.diagnostics.missingWhere", { col }),
  missingWhereBefore: (expr: string) => mi("sqlEditor.diagnostics.missingWhereBefore", { expr }),
  missingOperator: (word: string) => mi("sqlEditor.diagnostics.missingOperator", { word }),
  unexpectedIdent: (word: string) => mi("sqlEditor.diagnostics.unexpectedIdent", { word }),
  get badLikePattern() {
    return m("sqlEditor.diagnostics.badLikePattern");
  },
  get unexpectedClose() {
    return m("sqlEditor.diagnostics.unexpectedClose");
  },
  unexpectedComma: (line: number, col: number) =>
    mi("sqlEditor.diagnostics.unexpectedComma", { line, col }),
  generic: (ch: string, line: number, col: number) =>
    mi("sqlEditor.diagnostics.generic", { ch, line, col }),

  // Semantic / schema errors (returned by the backend, not caught client-side).
  // These reference an identifier that we locate in the query text.
  fieldNotFound: (field: string) => mi("sqlEditor.diagnostics.fieldNotFound", { field }),
  functionNotFound: (fn: string) => mi("sqlEditor.diagnostics.functionNotFound", { fn }),
  incompatibleType: (field: string) => mi("sqlEditor.diagnostics.incompatibleType", { field }),
  streamNotFound: (stream: string) => mi("sqlEditor.diagnostics.streamNotFound", { stream }),
  groupByMissing: (col: string) => mi("sqlEditor.diagnostics.groupByMissing", { col }),
  ambiguousColumn: (col: string) => mi("sqlEditor.diagnostics.ambiguousColumn", { col }),
  duplicateColumn: (col: string) => mi("sqlEditor.diagnostics.duplicateColumn", { col }),
  tableNotFound: (tbl: string) => mi("sqlEditor.diagnostics.tableNotFound", { tbl }),
  functionSignature: (fn: string) => mi("sqlEditor.diagnostics.functionSignature", { fn }),
} as const;

// ─── Backward context scanner ─────────────────────────────────────────────────

/**
 * Walk backward through `sql[0..offset]` tracking open constructs and return
 * a label for the innermost unclosed SQL construct at the cursor.
 *
 * Returned labels (used by buildContextualSqlMessage):
 *   "CASE_WHEN"   — inside CASE … WHEN … (no THEN yet)
 *   "CASE_THEN"   — inside CASE … THEN … (waiting for next WHEN/ELSE/END)
 *   "CASE_ELSE"   — inside CASE … ELSE … (waiting for END)
 *   "CASE"        — CASE with nothing after it yet
 *   "COALESCE"    — inside COALESCE(…,  (trailing comma, needs another arg)
 *   "OVER"        — inside OVER (… window spec not closed
 *   "PARTITION"   — after PARTITION BY inside OVER
 *   "CTE"         — inside WITH name AS (…
 *   "SUBQUERY"    — inside FROM (… or (SELECT …
 *   ""            — unknown / no specific construct found
 */
function innermostConstruct(sql: string, offset: number): string {
  const text = sql.substring(0, offset).trimEnd();
  const tokens: string[] = [];

  // Tokenise: extract words and single-char punctuation, skip string literals
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    // Skip quoted strings/identifiers. Handles both backslash-escape (\')
    // and SQL-standard doubled-quote escape ('').
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch;
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === q) {
          i++;
          if (text[i] === q) {
            i++;
            continue;
          } // doubled-quote escape: '' or ""
          break;
        }
        i++;
      }
      continue;
    }
    // Skip block comments
    if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // Skip line comments
    if (text[i] === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    // Word token
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i;
      while (j < text.length && /[a-zA-Z0-9_$]/.test(text[j])) j++;
      tokens.push(text.slice(i, j).toUpperCase());
      i = j;
      continue;
    }
    // Punctuation we care about
    if (ch === "(" || ch === ")" || ch === ",") {
      tokens.push(ch);
    }
    i++;
  }

  // Walk the token list forward, maintaining a stack of open constructs.
  // Each stack frame: { kind: string }
  type Frame = { kind: string };
  const stack: Frame[] = [];

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    const prev = tokens[t - 1] ?? "";
    const prev2 = tokens[t - 2] ?? "";

    if (tok === "CASE") {
      stack.push({ kind: "CASE" });
    } else if (tok === "END") {
      // close innermost CASE frame
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].kind.startsWith("CASE")) {
          stack.splice(s, 1);
          break;
        }
      }
    } else if (tok === "WHEN") {
      // Update the innermost CASE frame to CASE_WHEN
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].kind.startsWith("CASE")) {
          stack[s].kind = "CASE_WHEN";
          break;
        }
      }
    } else if (tok === "THEN") {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].kind.startsWith("CASE")) {
          stack[s].kind = "CASE_THEN";
          break;
        }
      }
    } else if (tok === "ELSE") {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].kind.startsWith("CASE")) {
          stack[s].kind = "CASE_ELSE";
          break;
        }
      }
    } else if (tok === "(") {
      // Determine what kind of paren this is from the token before it
      const funcName = prev.replace(/^\(*/, "");
      if (funcName === "OVER") {
        stack.push({ kind: "OVER" });
      } else if (prev === "AS" && prev2 !== "CAST" && prev2 !== "TRY_CAST") {
        // WITH cte AS (
        stack.push({ kind: "CTE" });
      } else if (funcName === "COALESCE" || funcName === "NULLIF" || funcName === "IIF") {
        stack.push({ kind: funcName });
      } else if (funcName === "FROM" || prev === "") {
        stack.push({ kind: "SUBQUERY" });
      } else {
        stack.push({ kind: "PAREN" });
      }
    } else if (tok === ")") {
      if (stack.length > 0) stack.pop();
    } else if (tok === "PARTITION") {
      // Mark the innermost OVER frame
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].kind === "OVER") {
          stack[s].kind = "PARTITION";
          break;
        }
      }
    }
  }

  // The innermost open frame is the last element
  return stack.length > 0 ? stack[stack.length - 1].kind : "";
}

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

/**
 * True when the LIKE/ILIKE/RLIKE operand closest to the error position is a
 * bare (unquoted) wildcard pattern, e.g. `uri_path LIKE /api/%`.
 *
 * Only a pattern whose first character cannot continue an identifier (e.g.
 * `LIKE BIN-%`) makes the parser stop on the `%` itself; `LIKE E00%` parses as
 * the identifier `E00` followed by the modulo operator and fails on whatever
 * token comes next, so the position alone cannot classify it.
 *
 * Quoted patterns, parenthesised expressions and function calls (`LIKE '%a%'`,
 * `LIKE CONCAT(p, '%')`) are valid operands and never match: the operand must
 * contain a `%` and no quote or parenthesis at all.
 *
 * A pattern that contains a space (`LIKE 'GET %'` unquoted becomes
 * `LIKE GET %`) lexes as an identifier followed by a bare `%`, so the wildcard
 * lands in the token after the operand — that shape counts too.
 */
function hasUnquotedLikePattern(sql: string, offset: number): boolean {
  const head = sql.substring(0, offset);
  let operandStart = -1;
  for (const m of head.matchAll(/\b(?:I|R)?LIKE\s+/gi)) {
    operandStart = (m.index ?? 0) + m[0].length;
  }
  if (operandStart < 0) return false;

  const rest = sql.substring(operandStart);
  const operand = rest.match(/^\S+/)?.[0] ?? "";
  if (/^[^\s'"`()]*%[^\s'"`()]*$/.test(operand)) return true;
  // `LIKE GET %` — bare operand whose wildcard is the next token
  return /^[^\s'"`(),]+\s+%/.test(rest);
}

/**
 * True when a filter expression follows the table reference with no WHERE
 * keyword between them, e.g. `FROM "default" re_match(log, 'x') AND y = 1`
 * or `FROM "default" a a.latency_ms > 100`.
 *
 * The parser reports these at the token where the text stops being a plausible
 * table reference — the `AND`, or the inner `(` of the call — which is several
 * tokens past where the condition actually started, so the token at the error
 * position alone cannot classify them.
 *
 * Returns the first identifier of that expression (used to name the problem in
 * the message), or null when the text between FROM and the error is not that
 * shape — including every case where a clause keyword intervenes, which means
 * the parser was past the FROM clause and the failure is something else.
 */
function filterExpressionAfterFrom(sql: string, offset: number): string | null {
  const head = sql.substring(0, offset);
  let fromEnd = -1;
  for (const m of head.matchAll(/\bFROM\b/gi)) {
    fromEnd = (m.index ?? 0) + m[0].length;
  }
  if (fromEnd < 0) return null;

  const segment = sql.substring(fromEnd, offset);
  if (
    /\b(?:SELECT|WHERE|GROUP|HAVING|ORDER|LIMIT|OFFSET|JOIN|ON|USING|UNION|EXCEPT|INTERSECT|WINDOW)\b/i.test(
      segment,
    )
  ) {
    return null;
  }

  // Table reference (quoted or bare, optional alias) followed by more text.
  const parts = segment.match(
    /^\s*(?:"[^"]*"|`[^`]*`|[a-zA-Z_$][\w$]*)(?:\s+(?:AS\s+)?[a-zA-Z_$][\w$]*)?\s+(\S[\s\S]*)$/,
  );
  if (!parts) return null;

  const rest = parts[1].trim();
  // Neither a comparison nor a function call can legally follow a table
  // reference — both mean the WHERE keyword was dropped.
  const startsComparison =
    /^[a-zA-Z_$][\w$]*(?:\.[\w$]+)*\s*(?:=|!=|<>|<=|>=|<|>|\b(?:IS|IN|NOT|LIKE|ILIKE|RLIKE|BETWEEN)\b)/i.test(
      rest,
    );
  const startsCall = /^[a-zA-Z_$][\w$]*\s*\(/.test(rest);
  if (!startsComparison && !startsCall) return null;

  return rest.match(/^[a-zA-Z_$][\w$]*(?:\.[\w$]+)*/)?.[0] ?? null;
}

// ─── Core message builder ─────────────────────────────────────────────────────

/**
 * Convert a PEG SyntaxError from @openobserve/node-sql-parser into a
 * human-readable diagnostic message, or null if the error shape is
 * unrecognised (i.e. likely a parser-grammar gap rather than a user mistake).
 *
 * Returning null signals to validateSql that this error should be suppressed —
 * the allow-list model: only show errors for positively classified fingerprints.
 *
 * @param sql  The full SQL string that was parsed.
 * @param err  The SyntaxError thrown by node-sql-parser.
 */
export function buildContextualSqlMessage(sql: string, err: any): string | null {
  const loc = err?.location?.start;
  if (!loc) return err?.message?.split("\n")[0] ?? m("sqlEditor.diagnostics.syntaxError");

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

  // ── EOF after OVER ( — expSize is moderate (PARTITION/ORDER/ROWS in expected) ─
  if (found === null && has(exp, "PARTITION", "ORDER", "ROWS") && !has(exp, "AND", "OR", "WHERE")) {
    if (has(exp, "PARTITION")) return m("sqlEditor.diagnostics.incompleteOver");
  }

  // ── EOF inside nested constructs (CASE/COALESCE/OVER/subquery/CTE) ──────────
  // expSize > 50 + found===null is the PEG signature for "gave up inside a
  // deeply nested expression". Use the backward scanner to name the construct.
  if (found === null && expSize > 50) {
    const construct = innermostConstruct(sql, offset);
    switch (construct) {
      case "CASE_WHEN":
        return m("sqlEditor.diagnostics.incompleteCaseWhen");
      case "CASE_THEN":
        return m("sqlEditor.diagnostics.incompleteCaseThen");
      case "CASE_ELSE":
        return m("sqlEditor.diagnostics.incompleteCaseElse");
      case "CASE":
        return m("sqlEditor.diagnostics.incompleteCase");
      case "COALESCE":
        return m("sqlEditor.diagnostics.incompleteCoalesce");
      case "NULLIF":
        return m("sqlEditor.diagnostics.incompleteNullif");
      case "IIF":
        return m("sqlEditor.diagnostics.incompleteIif");
      case "PARTITION":
        return m("sqlEditor.diagnostics.incompletePartitionBy");
      case "OVER":
        return m("sqlEditor.diagnostics.incompleteOver");
      case "CTE":
        return m("sqlEditor.diagnostics.incompleteCte");
      case "SUBQUERY":
        return m("sqlEditor.diagnostics.incompleteSubquery");
      default: {
        // construct is "" or "PAREN" — scanner found no unclosed named construct.
        // Fall back to lastWord for keywords that produce large expSizes.
        const lw = lastWord();
        if (lw === "ON") return MSG.incompleteJoinOn;
        if (lw === "DISTINCT") return MSG.incompleteDistinct;
        if (lw === "AND") {
          // Could be BETWEEN x AND <eof> — check for BETWEEN in the token stream
          const prev = sql.substring(0, offset).trimEnd().toUpperCase();
          if (/\bBETWEEN\b/.test(prev)) return MSG.incompleteBetween;
          return MSG.incompleteAnd;
        }
        // Fall through to the existing EOF checks
      }
    }
  }

  // ── EOF errors (found === null) ─────────────────────────────────────────────
  if (found === null) {
    // ORDER/GROUP incomplete, lastWord-gated: when the query ends right after the
    // ORDER/GROUP keyword and BY is expected, classify regardless of expSize. The
    // candidate set balloons inside subqueries/CTEs/WITHIN GROUP (expSize 12-24),
    // so the expSize<=10 cap below misses those; the lastWord gate is the strong
    // signal here, not the size.
    if (has(exp, "BY")) {
      const lwBy = lastWord();
      if (lwBy === "ORDER") return MSG.incompleteOrder;
      if (lwBy === "GROUP") return MSG.incompleteGroup;
    }

    // ORDER/GROUP incomplete: only [BY] (+ comment/whitespace tokens) expected
    // Also catches expSize === 0 or 1 (nothing expected → query ended mid-keyword)
    if ((has(exp, "BY") && expSize <= 10) || expSize <= 1) {
      // Determine whether it was ORDER or GROUP from the last token before EOF
      const lw = lastWord();
      if (lw === "ORDER") return MSG.incompleteOrder;
      if (lw === "GROUP") return MSG.incompleteGroup;
      // Already have BY (e.g. "ORDER BY") — need a column
      const prev2 = sql
        .substring(0, offset)
        .trimEnd()
        .split(/\s+/)
        .slice(-2)
        .map((t) => t.toUpperCase());
      if (prev2.includes("ORDER")) return MSG.incompleteOrderBy;
      if (prev2.includes("GROUP")) return MSG.incompleteGroupBy;
      return MSG.incompleteExpr;
    }

    // LIMIT/OFFSET incomplete: expected has number/sign tokens but no SQL keywords
    if (
      !has(
        exp,
        "AND",
        "OR",
        "NOT",
        "BY",
        "WHERE",
        "HAVING",
        "FROM",
        "SELECT",
        "NULL",
        "TRUE",
        "FALSE",
      )
    ) {
      const lw = lastWord();
      if (lw === "LIMIT") return MSG.incompleteLimit;
      if (lw === "OFFSET") return MSG.incompleteOffset;
    }

    // Expression expected (WHERE / HAVING / AND / OR / NOT / GROUP BY / open paren / after operator)
    if (has(exp, "NOT", "NULL", "TRUE", "FALSE") && has(exp, "SELECT")) {
      const lw = lastWord();
      switch (lw) {
        case "AND":
          return MSG.incompleteAnd;
        case "OR":
          return MSG.incompleteOr;
        case "NOT":
          return MSG.incompleteNot;
        case "WHERE":
          return MSG.incompleteWhere;
        case "HAVING":
          return MSG.incompleteHaving;
        case "(":
          return MSG.incompleteOpenParen;
        default: {
          const tokens = sql.substring(0, offset).trimEnd().split(/\s+/).filter(Boolean);
          const last = tokens[tokens.length - 1]?.replace(/^\(*/, "").toUpperCase() ?? "";
          const prev = tokens[tokens.length - 2]?.replace(/^\(*/, "").toUpperCase() ?? "";
          if (last === "BY" && prev === "GROUP") return MSG.incompleteGroupBy;
          if (last === "BY" && prev === "ORDER") return MSG.incompleteOrderBy;
          if (last === "(") return MSG.incompleteOpenParen;
          return MSG.incompleteExpr;
        }
      }
    }

    // LIKE/ILIKE: expected contains quoted-string tokens but not AND/OR
    if (!has(exp, "AND", "OR") && has(exp, "NULL", "TRUE", "FALSE") && !has(exp, "SELECT")) {
      const lw = lastWord();
      if (lw === "NOT") return MSG.incompleteNot;
      if (["LIKE", "ILIKE", "RLIKE"].includes(lw)) return MSG.incompleteLike;
      if (["=", "!=", "<>", "<", ">", "<=", ">="].includes(lw)) return MSG.incompleteComparison(lw);
      if (lw === "IS") return MSG.incompleteIs;
      if (lw === "BETWEEN") return MSG.incompleteBetween;
    }

    // IN incomplete: expected contains "(" and function names but not AND/OR/NOT
    if (!has(exp, "AND", "OR", "NOT", "NULL", "TRUE", "FALSE", "SELECT") && has(exp, "(")) {
      const lw = lastWord();
      if (lw === "IN" || lw === "NOT") return MSG.incompleteIn;
    }

    // UNION / UNION ALL incomplete: expected contains ALL, DISTINCT, SELECT but no AND/OR
    if (has(exp, "ALL", "SELECT") && !has(exp, "AND", "OR", "WHERE", "HAVING")) {
      const lw = lastWord();
      if (lw === "UNION" || lw === "ALL") return MSG.incompleteUnion;
    }

    // JOIN ON incomplete: lastWord is ON and expSize is large (expression expected)
    {
      const lw = lastWord();
      if (lw === "ON") return MSG.incompleteJoinOn;
      if (lw === "DISTINCT") return MSG.incompleteDistinct;
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

    // Unrecognised EOF shape — suppress rather than show a misleading message
    return null;
  }

  // ── Unexpected token errors (found !== null) ────────────────────────────────

  // Extract full word at error position (PEG only gives first char in `found`)
  const wordAtError = sql.substring(offset).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/)?.[0] ?? found;

  // found "=" or an identifier/operator with WHERE in expected → missing WHERE keyword
  // Covers: "FROM t col = val" (found="=") and "FROM t col IS NULL" (found="I" for IS)
  // Guard: only fire when the token BEFORE the error looks like a column identifier
  // AND the token AT the error is an operator or starts a comparison keyword (IS/IN/LIKE).
  // This prevents misfiring on valid DataFusion-only syntax (AT TIME ZONE, EXCEPT, etc.)
  // that the client grammar doesn't recognise but that appear at clause boundaries.
  if (has(exp, "WHERE", "HAVING", "LIMIT") && !has(exp, "AND", "OR")) {
    const tokenBefore = sql.substring(0, offset).trimEnd().split(/\s+/).pop() ?? "";
    // Token before must be a bare identifier (column name or alias), not a
    // closing paren/quote/function call which would indicate a grammar gap.
    const isBareIdent = /^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(tokenBefore);
    const atErrorStr = sql.substring(offset);
    const atErrorIsOperator =
      /^[=<>!]/.test(found) || /^(IS|NOT|IN|LIKE|ILIKE|RLIKE|BETWEEN)\b/i.test(atErrorStr);
    if (isBareIdent && atErrorIsOperator) {
      return MSG.missingWhere(tokenBefore);
    }
    // Same mistake, reported one token earlier: with a table alias in play
    // (`FROM "default" a a.latency_ms > 100`) the error lands on the condition's
    // own column, so the operator is one identifier further along.
    const conditionStart = atErrorStr.match(
      /^[a-zA-Z_$][\w$]*(?:\.[\w$]+)*(?=\s*(?:=|!=|<>|<=|>=|<|>|\b(?:IS|IN|NOT|LIKE|ILIKE|RLIKE|BETWEEN)\b))/i,
    )?.[0];
    if (isBareIdent && conditionStart) return MSG.missingWhereBefore(conditionStart);
    // Or reported further along: the condition starts right after the table
    // reference, so the error lands on the AND / the call's own parenthesis
    // rather than on the operator.
    const expr = filterExpressionAfterFrom(sql, offset);
    if (expr) return MSG.missingWhereBefore(expr);
    // Not a recognisable missing-WHERE pattern — fall through to suppression
  }

  // found identifier, AND/OR operators in expected → missing AND/OR between conditions
  if (/^[a-zA-Z_$]/.test(found) && has(exp, "AND", "OR")) {
    // Check char before error: if it ends a value (quote, digit, paren) → missing operator
    const charBeforeError = sql.substring(0, offset).trimEnd().slice(-1);
    if (
      ["'", '"', ")", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(charBeforeError)
    ) {
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

  // Unquoted LIKE pattern whose first character does not terminate the
  // identifier — `x LIKE E00%` parses as the identifier E00 followed by the
  // modulo operator, so the parser fails on a later token and the found === "%"
  // check above never fires. Checked last, so it only reclassifies errors that
  // would otherwise be suppressed.
  if (hasUnquotedLikePattern(sql, offset)) return MSG.badLikePattern;

  // Unrecognised unexpected-token shape — suppress to avoid false positives
  return null;
}

// ─── Parser-limitation guards ─────────────────────────────────────────────────

/**
 * Check if a PEG SyntaxError is a parser limitation rather than a real
 * user mistake.  The client parser doesn't support every construct the
 * OpenObserve backend accepts (e.g. PERCENT_RANK() OVER, CUME_DIST() OVER,
 * POSITION(str IN str), EXCEPT, GROUPING SETS, or array literals).
 *
 * When this returns true the caller should treat the SQL as valid — the
 * backend will parse it correctly.
 *
 * @param err  The SyntaxError thrown by node-sql-parser.
 * @param sql  The SQL that was parsed (optional; tightens Guard 3).
 */
export function isParserLimitation(err: any, sql?: string): boolean {
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

  // Guard 3: POSITION(str IN str) syntax — parser doesn't support it.
  // found=")" with small expected set. Tightened: only suppress when the text
  // before the error position actually contains "POSITION(" so we don't
  // accidentally suppress real unclosed-paren user errors.
  if (
    err?.found === ")" &&
    !expLits.has(")") &&
    !expLits.has("AND") &&
    !expLits.has("OR") &&
    expSize < 50
  ) {
    if (!sql) return true; // no SQL available — apply original heuristic
    const offset: number = err?.location?.start?.offset ?? sql.length;
    if (/\bPOSITION\s*\(/i.test(sql.substring(0, offset))) return true;
  }

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

  // Guard 5: Known DataFusion constructs the client PEG grammar doesn't support.
  //   • EXCEPT / EXCEPT ALL (found is first letter of "SELECT" after EXCEPT)
  //   • GROUPING SETS       (found is first letter of "SETS")
  //   • Array literals      (found is "[")
  //   • AT TIME ZONE        (found is "T" of "TIME"; WHERE is in expected because
  //                          the parser expected end-of-query clause keywords)
  // Fingerprint: found is a single letter or "[" with no AND/OR/closing-paren
  // in the literal set, and the text before the error matches the construct.
  if (err?.found != null && !expLits.has("AND") && !expLits.has("OR") && !expLits.has(")")) {
    const offset: number = err?.location?.start?.offset ?? sql?.length ?? 0;
    const textBefore = sql ? sql.substring(0, offset).trimEnd().toUpperCase() : "";
    if (
      err.found === "[" ||
      /\bEXCEPT\s*$/.test(textBefore) ||
      /\bGROUPING\s*$/.test(textBefore) ||
      /\bAT(\s+(TIME\s*)?)?$/.test(textBefore)
    )
      return true;
  }

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
 * Returns `null` if valid (or the error is unclassified / a parser-grammar gap),
 * or an `SqlErrorRange` with a contextual message for a positively identified error.
 *
 * @param sql         Full SQL to validate.
 * @param lineOffset  Add this to the error line number (for multi-line constructed SQL
 *                    where the user's filter starts on a line > 1).
 * @param colOffset   Subtract this from the error column on line 1 of the constructed
 *                    SQL, so the squiggle points into the user's filter text rather
 *                    than a constructed SQL prefix. Only applied when error is on
 *                    line 1 (errors on later lines don't include the prefix column).
 */
export async function validateSql(
  sql: string,
  lineOffset = 0,
  colOffset = 0,
): Promise<SqlErrorRange | null> {
  if (maxParenDepth(sql) > SQL_PARSE_MAX_DEPTH) return null;

  const parser = await getParser();
  try {
    parser.astify(sql);
    return null;
  } catch (err: any) {
    // Suppress known parser-grammar gaps — DataFusion accepts these even though
    // the client PEG grammar rejects them.
    if (isParserLimitation(err, sql)) return null;

    const loc = err?.location?.start;
    const errLine: number = loc?.line ?? 1;
    const line = Math.max(1, errLine + lineOffset);
    // colOffset only applies when the error is on line 1 of the constructed SQL;
    // errors on subsequent lines don't carry the prefix width in their column.
    const rawCol: number = loc?.column ?? 1;
    const col = Math.max(1, errLine === 1 ? rawCol - colOffset : rawCol);

    const msg = buildContextualSqlMessage(sql, err);
    // null means unrecognised error shape — suppress rather than show a wrong message
    if (msg === null) return null;

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
    // Client parser returned null for one of two reasons:
    //   (a) It accepted the SQL (semantic error on server side — unknown column, etc.)
    //       → Don't show a squiggle; the error isn't locatable client-side.
    //   (b) It hit a parser-limitation or unclassified fingerprint and suppressed.
    //       → Fall through and use the server-reported position with a cleaned message,
    //         because the server told us there IS a real parse error at a known location.
    // Distinguish: re-parse and check if it throws at all. Skipped past
    // SQL_PARSE_MAX_DEPTH for the same reason validateSql skips it above —
    // treat as case (b) below rather than hang re-parsing a query we already
    // know is too complex to check client-side.
    let clientThrows = maxParenDepth(originalSql) > SQL_PARSE_MAX_DEPTH;
    if (!clientThrows) {
      const parser = await getParser();
      try {
        parser.astify(originalSql);
      } catch {
        clientThrows = true;
      }
    }
    if (!clientThrows) return []; // case (a): client accepted — semantic error only
    // case (b): client rejected but suppressed — use server position + cleaned message
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

// ─── Semantic (schema) error support ──────────────────────────────────────────
//
// Backend search errors that reference an identifier (field/function/stream)
// but carry NO line/column position. We extract the identifier from the error
// text and locate every occurrence of it in the query so the editor can
// squiggle the exact token(s). See src/infra/src/errors/{mod,grpc}.rs for the
// message formats each code produces.

/** One located token occurrence, in 1-based editor coordinates. */
interface TokenHit {
  line: number;
  startCol: number;
  /** Exclusive end column (Monaco-style: one past the last char). */
  endCol: number;
}

/**
 * Find every whole-token occurrence of `rawName` in `sql`, skipping string
 * literals and comments. Matches bare identifiers (`error_id`) and quoted
 * identifiers (`"error_id"`, `` `error_id` ``). Case-insensitive, since
 * DataFusion folds identifiers to lower case.
 *
 * A double-quoted token is treated as an identifier (SQL semantics), not a
 * string literal, so quoted field/stream names are still located.
 */
export function locateIdentifier(sql: string, rawName: string): TokenHit[] {
  // Backend usually gives a bare name; guard against dotted (stream.field) forms.
  const cleaned = rawName.replace(/[`"']/g, "").trim();
  const name = cleaned.includes(".") ? cleaned.split(".").pop()! : cleaned;
  if (!name) return [];
  const target = name.toLowerCase();
  const hits: TokenHit[] = [];

  const n = sql.length;
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = () => {
    if (sql[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    i++;
  };

  while (i < n) {
    const ch = sql[i];

    // Line comment
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") advance();
      continue;
    }
    // Block comment
    if (ch === "/" && sql[i + 1] === "*") {
      advance();
      advance();
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) advance();
      if (i < n) {
        advance();
        advance();
      }
      continue;
    }
    // Single-quoted string literal — never an identifier, skip.
    if (ch === "'") {
      advance();
      while (i < n) {
        if (sql[i] === "\\") {
          advance();
          advance();
          continue;
        }
        if (sql[i] === "'") {
          advance();
          if (sql[i] === "'") {
            advance();
            continue;
          } // '' escape
          break;
        }
        advance();
      }
      continue;
    }
    // Double/backtick-quoted identifier — candidate match.
    if (ch === '"' || ch === "`") {
      const q = ch;
      const startLine = line;
      const startCol = col;
      advance(); // opening quote
      let inner = "";
      while (i < n) {
        if (sql[i] === q) {
          advance();
          if (sql[i] === q) {
            inner += q;
            advance();
            continue;
          } // "" escape
          break;
        }
        inner += sql[i];
        advance();
      }
      if (inner.toLowerCase() === target) {
        hits.push({ line: startLine, startCol, endCol: col });
      }
      continue;
    }
    // Bare word token.
    if (/[a-zA-Z_$]/.test(ch)) {
      const startLine = line;
      const startCol = col;
      let word = "";
      while (i < n && /[a-zA-Z0-9_$]/.test(sql[i])) {
        word += sql[i];
        advance();
      }
      if (word.toLowerCase() === target) {
        hits.push({ line: startLine, startCol, endCol: col });
      }
      continue;
    }
    advance();
  }

  return hits;
}

/** Strip quotes/backticks and trailing punctuation from an extracted identifier. */
function cleanIdent(raw: string | undefined | null): string | null {
  if (!raw) return null;
  // Strip quotes/backticks and any leading/trailing punctuation, but KEEP
  // internal dots so a qualified name (schema.col) survives — locateIdentifier
  // resolves it to its last segment when searching the query text.
  const cleaned = raw
    .replace(/[`"']/g, "")
    .replace(/^[.,\s]+|[.,\s]+$/g, "")
    .trim();
  return cleaned || null;
}

/**
 * Pull the offending identifier + a contextual message out of a server error.
 *
 * Code-agnostic by design: it sniffs the combined message/error_detail text for
 * the backend's distinctive phrasings rather than dispatching on the 2000x code.
 * Some callers (e.g. dashboards) only surface the HTTP status, not the business
 * code, so relying on the code would silently miss those. The phrasings below
 * are specific enough that false positives on unrelated errors (timeouts, rate
 * limits) are very unlikely — those simply match nothing and return null.
 *
 * Ordered most-specific first. See src/infra/src/errors/{mod,grpc}.rs.
 */
function extractSemanticError(text: string): { field: string; message: string } | null {
  // Field not found (20004): DataFusion "No field named X" or the wrapped
  // "Search field not found: <field>. Field not found in stream schema."
  const noField = cleanIdent(text.match(/No field named\s+`?([^`.\s,]+)`?/i)?.[1]);
  if (noField) return { field: noField, message: MSG.fieldNotFound(noField) };
  const fieldNotFound = cleanIdent(
    text.match(/Search field not found:\s*([A-Za-z_$][\w$]*)/i)?.[1],
  );
  if (fieldNotFound) return { field: fieldNotFound, message: MSG.fieldNotFound(fieldNotFound) };

  // Function not defined (20005): "Invalid function 'foo'" / "Search function
  // not defined: foo".
  const fn = cleanIdent(
    text.match(/Invalid function\s+'?([A-Za-z_$][\w$]*)'?/i)?.[1] ??
      text.match(/Search function not defined:\s*([A-Za-z_$][\w$]*)/i)?.[1],
  );
  if (fn) return { field: fn, message: MSG.functionNotFound(fn) };

  // Incompatible data type (20007): DataFusion "for field <name>"; the backend
  // also re-wraps it as "Search field has no compatible data type: field <name>".
  const typeField = cleanIdent(
    text.match(/for field\s+([A-Za-z_$][\w$]*)/i)?.[1] ??
      text.match(/no compatible data type:\s*(?:field\s+)?([A-Za-z_$][\w$]*)/i)?.[1],
  );
  if (typeField) return { field: typeField, message: MSG.incompatibleType(typeField) };

  // Stream not found (20002): "Search stream not found: <stream>".
  const stream = cleanIdent(text.match(/Search stream not found:\s*([^\s,]+)/i)?.[1]);
  if (stream) return { field: stream, message: MSG.streamNotFound(stream) };

  // ── Execute / planning errors (20008) — free-text DataFusion strings ─────────

  // GROUP BY: a selected column is neither grouped nor aggregated. DataFusion's
  // wording is "Projection references non-aggregate values: Expression <col>
  // could not be resolved …"; some versions/engines say "<col> must appear in
  // the GROUP BY clause".
  const groupBy = cleanIdent(
    text.match(/Projection references non-aggregate values:\s*Expression\s+([\w$.]+)/i)?.[1] ??
      text.match(/([\w$.]+)\s+must appear in the GROUP BY/i)?.[1],
  );
  if (groupBy) return { field: groupBy, message: MSG.groupByMissing(groupBy) };

  // Ambiguous column: DataFusion says "… unqualified field name <col> which
  // would be ambiguous" or "Ambiguous reference to (unqualified) field <col>".
  // The trailing "<col> is ambiguous" form is kept for other engines.
  const ambiguous = cleanIdent(
    text.match(/unqualified field name\s+([\w$.]+)\s+which would be ambiguous/i)?.[1] ??
      text.match(/Ambiguous reference to (?:unqualified )?field\s+([\w$.]+)/i)?.[1] ??
      text.match(/(?:Column|Reference)\s+'?"?([\w$.]+)"?'?\s+is ambiguous/i)?.[1],
  );
  if (ambiguous) return { field: ambiguous, message: MSG.ambiguousColumn(ambiguous) };

  // Duplicate column: "Schema contains duplicate (un)qualified field name <col>".
  const duplicate = cleanIdent(
    text.match(/duplicate (?:un)?qualified field name\s+([\w$.]+)/i)?.[1],
  );
  if (duplicate) return { field: duplicate, message: MSG.duplicateColumn(duplicate) };

  // Table / CTE not found (JOINs & subqueries): "Table or CTE with name '<t>'
  // not found" / "table '<t>' not found".
  const table = cleanIdent(
    text.match(/Table or CTE with name\s+'?([\w$.]+)'?\s+not found/i)?.[1] ??
      text.match(/\btable\s+'([\w$.]+)'\s+not found/i)?.[1],
  );
  if (table) return { field: table, message: MSG.tableNotFound(table) };

  // Function called with the wrong argument types (the function DOES exist):
  // "No function matches the given name and argument types '<fn>(…)'".
  const badFnArgs = cleanIdent(
    text.match(/No function matches[^']*'([A-Za-z_$][\w$]*)\s*\(/i)?.[1],
  );
  if (badFnArgs) return { field: badFnArgs, message: MSG.functionSignature(badFnArgs) };

  return null;
}

/**
 * Unified server-error → editor ranges entry point. Handles ALL locatable
 * search error codes. This is the single function response handlers should
 * call; it dispatches to the right strategy:
 *   • 20001 (syntax)   → sqlparser line/column (SQL mode) or reconstructed-SQL
 *                        parse (non-SQL mode) — precise positions from the parser.
 *   • 20002/4/5/7/8    → locate the offending identifier in the query text and
 *                        squiggle every occurrence.
 * Returns [] when the error carries nothing locatable (e.g. 20003 full-text
 * field, timeouts, rate limits).
 *
 * @param query      The exact text in the editor (raw SQL, or the filter text
 *                   in non-SQL mode). Used both to locate identifiers and to
 *                   reconstruct SQL for the non-SQL syntax path.
 * @param streamName Selected stream — only needed to wrap non-SQL filters.
 */
export async function rangesFromServerError(params: {
  code?: number;
  message?: I18nText;
  errorDetail?: string;
  sqlMode: boolean;
  query?: string;
  streamName?: string;
}): Promise<SqlErrorRange[]> {
  const { code, message = "", errorDetail = "", sqlMode, query = "", streamName } = params;

  if (!query.trim()) return [];

  const text = `${message} ${errorDetail}`;

  // ── Syntax errors: defer to the parser-position extractors ──────────────────
  // Code-agnostic: code 20001, or a message carrying the sqlparser location /
  // ParserError signature (some callers surface only the HTTP status, not the
  // 2000x business code). Falls through to the semantic path if it locates
  // nothing (the client parser can't always reproduce the server's error).
  const looksLikeSyntax =
    code === 20001 ||
    /at\s+Line:\s*\d+,\s*Column:\s*\d+/i.test(text) ||
    /ParserError|sql parser error/i.test(text);
  if (looksLikeSyntax) {
    let syntaxRanges: SqlErrorRange[] = [];
    if (sqlMode && (errorDetail || message)) {
      syntaxRanges = await rangesFromSqlParserDetail(errorDetail || message, query);
    } else if (!sqlMode && streamName) {
      const prefix = `select * from "${streamName}" WHERE `;
      syntaxRanges = await rangesFromServerMessage(
        message || errorDetail || "",
        prefix + query,
        prefix.length,
      );
    }
    if (syntaxRanges.length) return syntaxRanges;
  }

  // ── Semantic errors: locate the identifier the backend named ────────────────
  const semantic = extractSemanticError(text);
  if (!semantic) return [];

  const hits = locateIdentifier(query, semantic.field);
  if (!hits.length) return [];

  return hits.map((h) => ({
    startLine: h.line,
    endLine: h.line,
    column: h.startCol,
    endColumn: h.endCol,
    error: semantic.message,
  }));
}
