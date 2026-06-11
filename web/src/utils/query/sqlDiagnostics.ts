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

  // UNION / JOIN / DISTINCT
  incompleteUnion:      "Incomplete UNION — expected SELECT after UNION or UNION ALL",
  incompleteJoinOn:     "Incomplete JOIN — expected a condition after ON",
  incompleteDistinct:   "Incomplete SELECT — expected column names after DISTINCT",

  // Unexpected token
  missingWhere:     (col: string) => `Missing WHERE keyword — did you mean: … FROM … WHERE ${col} = …?`,
  missingOperator:  (word: string) => `Missing operator before '${word}' — did you forget AND or OR?`,
  unexpectedIdent:  (word: string) => `Unexpected '${word}' — did you forget AND, OR, or an operator?`,
  badLikePattern:   "Invalid LIKE pattern — wrap the pattern in single quotes, e.g. LIKE '%value%'",
  unexpectedClose:  "Unexpected closing parenthesis ) — check that every ( has a matching )",
  unexpectedComma:  (line: number, col: number) => `Unexpected comma at line ${line}, column ${col} — check your column list or function arguments`,
  generic:          (ch: string, line: number, col: number) => `Unexpected '${ch}' at line ${line}, column ${col}`,
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
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === q) {
          i++;
          if (text[i] === q) { i++; continue; } // doubled-quote escape: '' or ""
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
        if (stack[s].kind.startsWith("CASE")) { stack.splice(s, 1); break; }
      }
    } else if (tok === "WHEN") {
      // Update the innermost CASE frame to CASE_WHEN
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].kind.startsWith("CASE")) { stack[s].kind = "CASE_WHEN"; break; }
      }
    } else if (tok === "THEN") {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].kind.startsWith("CASE")) { stack[s].kind = "CASE_THEN"; break; }
      }
    } else if (tok === "ELSE") {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].kind.startsWith("CASE")) { stack[s].kind = "CASE_ELSE"; break; }
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
        if (stack[s].kind === "OVER") { stack[s].kind = "PARTITION"; break; }
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

  // ── EOF after OVER ( — expSize is moderate (PARTITION/ORDER/ROWS in expected) ─
  if (found === null && has(exp, "PARTITION", "ORDER", "ROWS") && !has(exp, "AND", "OR", "WHERE")) {
    if (has(exp, "PARTITION")) return "Incomplete OVER clause — expected PARTITION BY, ORDER BY, or closing )";
  }

  // ── EOF inside nested constructs (CASE/COALESCE/OVER/subquery/CTE) ──────────
  // expSize > 50 + found===null is the PEG signature for "gave up inside a
  // deeply nested expression". Use the backward scanner to name the construct.
  if (found === null && expSize > 50) {
    const construct = innermostConstruct(sql, offset);
    switch (construct) {
      case "CASE_WHEN":
        return "Incomplete CASE — expected THEN after the WHEN condition";
      case "CASE_THEN":
        return "Incomplete CASE — expected another WHEN, ELSE, or END";
      case "CASE_ELSE":
        return "Incomplete CASE — expected END to close the CASE expression";
      case "CASE":
        return "Incomplete CASE — expected WHEN after CASE";
      case "COALESCE":
        return "Incomplete COALESCE — expected another argument or closing )";
      case "NULLIF":
        return "Incomplete NULLIF — expected a second argument, e.g. NULLIF(expr, 0)";
      case "IIF":
        return "Incomplete IIF — expected condition, true-value, and false-value";
      case "PARTITION":
        return "Incomplete PARTITION BY — expected a column name or expression";
      case "OVER":
        return "Incomplete OVER clause — expected PARTITION BY, ORDER BY, or closing )";
      case "CTE":
        return "Incomplete CTE — expected ) to close the WITH expression";
      case "SUBQUERY":
        return "Incomplete subquery — expected SELECT or closing )";
      default: {
        // construct is "" or "PAREN" — scanner found no unclosed named construct.
        // Fall back to lastWord for keywords that produce large expSizes.
        const lw = lastWord();
        if (lw === "ON")       return MSG.incompleteJoinOn;
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
      if (lw === "NOT") return MSG.incompleteNot;
      if (["LIKE", "ILIKE", "RLIKE"].includes(lw)) return MSG.incompleteLike;
      if (["=", "!=", "<>", "<", ">", "<=", ">="].includes(lw)) return MSG.incompleteComparison(lw);
      if (lw === "IS")      return MSG.incompleteIs;
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
  const wordAtError =
    sql.substring(offset).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/)?.[0] ??
    found;

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
      /^[=<>!]/.test(found) ||
      /^(IS|NOT|IN|LIKE|ILIKE|RLIKE|BETWEEN)\b/i.test(atErrorStr);
    if (isBareIdent && atErrorIsOperator) {
      return MSG.missingWhere(tokenBefore);
    }
    // Not a recognisable missing-WHERE pattern — fall through to suppression
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
    const offset: number = err?.location?.start?.offset ?? (sql?.length ?? 0);
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
    // Distinguish: re-parse and check if it throws at all.
    const parser = await getParser();
    let clientThrows = false;
    try { parser.astify(originalSql); } catch { clientThrows = true; }
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
