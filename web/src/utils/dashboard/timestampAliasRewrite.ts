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

// Normalizes the reserved timestamp column (`_timestamp`) when it is used as a
// SQL *output alias* in a dashboard panel — which the query engine and our own
// validation reject (`Alias '_timestamp' is not allowed.`). The alias is
// rewritten to `ts` in the stored SQL, the matching field alias, and the panel
// configs that reference an alias. Only the OUTPUT alias moves; the source
// column (`histogram(_timestamp)`, `WHERE _timestamp`, args.field) is untouched.
//
// Pure and store-free so it can run inside convertDashboardSchemaVersion. It
// targets the literal `_timestamp` (the default timestamp column); callers with
// a custom `timestamp_column` may pass it explicitly.

/** The reserved timestamp column that is disallowed as an output alias. */
export const RESERVED_TS_ALIAS = "_timestamp";

/** Replacement alias standardized across dashboards. */
export const RESERVED_TS_ALIAS_REPLACEMENT = "ts";

// Every axis/field bucket that holds field configs with an `alias`.
const AXIS_KEYS = [
  "x",
  "y",
  "z",
  "breakdown",
  "latitude",
  "longitude",
  "weight",
  "source",
  "target",
  "value",
  "name",
  "value_for_maps",
];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isIdentChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

// Clause the scanner is currently inside, tracked per query scope.
const CLAUSE_OTHER = 0;
const CLAUSE_SELECT = 1;
const CLAUSE_FROM = 2;
const CLAUSE_GROUP = 3;
const CLAUSE_HAVING = 4;
const CLAUSE_ORDER = 5;

// A `_timestamp` token whose fate depends on where the scope's FROM comes from.
interface Deferred {
  start: number;
  end: number;
  quote: string;
  inProjection: boolean;
}

// One SELECT scope (top-level query or a sub-query `(SELECT …)`).
interface Scope {
  clause: number;
  expectAlias: boolean; // just saw `AS` in this scope's SELECT projection
  sawDefinition: boolean; // an `AS <tsCol>` was renamed in this scope
  // null = FROM not yet resolved; true = FROM is a sub-query that renamed its
  // `_timestamp` output (so this scope's `_timestamp` refs are that column);
  // false = FROM is a real table (so `_timestamp` refs are the source column).
  fromRenamed: boolean | null;
  deferred: Deferred[]; // refs waiting on `fromRenamed`
  outputRenamed: boolean; // this scope's output column `_timestamp` became `ts`
  parentWasFrom: boolean; // this sub-query sits in its parent's FROM clause
}

const newScope = (parentWasFrom = false): Scope => ({
  clause: CLAUSE_OTHER,
  expectAlias: false,
  sawDefinition: false,
  fromRenamed: null,
  deferred: [],
  outputRenamed: false,
  parentWasFrom,
});

/**
 * Rename the reserved timestamp column where it is used as a SQL OUTPUT ALIAS,
 * together with every reference to that alias — including references from an
 * outer query to a renamed sub-query column.
 *
 * A scope-aware SQL scanner (not a full parser). A `(SELECT …)` opens a query
 * scope; `histogram(…)` / `OVER (…)` / grouping parens are transparent (they
 * only save & restore the clause). Rules:
 *  - **definition** — `<expr> AS "_timestamp"` in a SELECT projection → `ts`.
 *    A self-alias `_timestamp AS _timestamp` becomes `_timestamp AS ts` (only the
 *    alias; the source expression is left).
 *  - **own-scope reference** — a standalone `_timestamp` in `GROUP BY` / `HAVING`
 *    / `ORDER BY` after that scope defined the alias → `ts`.
 *  - **cross-scope reference** — when a sub-query in a scope's FROM renames its
 *    `_timestamp` output, that scope's `_timestamp` references (function args,
 *    `GROUP BY`, `ORDER BY`, …) all become `ts`, so an outer `HISTOGRAM(_timestamp)`
 *    over the renamed sub-query follows the rename.
 *
 * Left intact: the physical source read (`histogram(_timestamp)` / `WHERE
 * _timestamp` over a real table), qualified refs (`t._timestamp`), table aliases,
 * string-literal contents. An alias defined inside a CTE referenced *by name*
 * from an outer scope can't be resolved by a scanner — the query is returned
 * unchanged rather than half-rewritten.
 */
export function rewriteQueryTimestampAlias(
  sql: string,
  tsCol: string = RESERVED_TS_ALIAS,
  newAlias: string = RESERVED_TS_ALIAS_REPLACEMENT,
): string {
  // Fast path: nothing to do if the reserved token never appears.
  if (!sql || !sql.includes(tsCol)) return sql;

  const edits: { start: number; end: number; text: string }[] = [];
  const stack: Scope[] = [newScope()];
  const parens: { isSubquery: boolean; savedClause: number }[] = [];
  const top = (): Scope => stack[stack.length - 1];
  let prevNonSpace = "";
  let cteRenamed = false; // an alias renamed inside a CTE-like scope (not a FROM sub-query)
  let keptRef = false; // a `_timestamp` reference was left as the source column
  let i = 0;
  const n = sql.length;

  const isRefClause = (c: number): boolean =>
    c === CLAUSE_GROUP || c === CLAUSE_HAVING || c === CLAUSE_ORDER;
  const renameText = (quote: string): string => (quote ? quote + newAlias + quote : newAlias);

  // Resolve a scope's deferred refs once its FROM origin is known. A kept ref only
  // signals orphan risk when the scope did NOT define an alias itself — a scope's
  // own physical source reads (e.g. `histogram(_timestamp)`) are fine.
  const resolveDeferred = (s: Scope, doRename: boolean): void => {
    for (const d of s.deferred) {
      if (doRename) {
        edits.push({ start: d.start, end: d.end, text: renameText(d.quote) });
        if (d.inProjection) s.outputRenamed = true;
      } else if (!s.sawDefinition) {
        keptRef = true;
      }
    }
    s.deferred = [];
  };

  // Is the next non-whitespace token at `p` a `SELECT` / `WITH` (i.e. a sub-query)?
  const opensSubquery = (p: number): boolean => {
    let k = p;
    while (k < n && /\s/.test(sql[k])) k++;
    const w = sql.slice(k, k + 6).toLowerCase();
    return (
      (w === "select" && !isIdentChar(sql[k + 6] || " ")) ||
      (w.startsWith("with") && !isIdentChar(sql[k + 4] || " "))
    );
  };

  // Handle a `_timestamp` token found at [start, end).
  const handleTs = (start: number, end: number, quote: string, precededByDot: boolean): void => {
    const s = top();
    if (precededByDot) {
      if (!s.sawDefinition) keptRef = true; // qualified `t._timestamp` — a specific source column
      return;
    }
    if (s.clause === CLAUSE_SELECT && s.expectAlias) {
      // alias definition
      edits.push({ start, end, text: renameText(quote) });
      s.expectAlias = false;
      s.sawDefinition = true;
      s.outputRenamed = true;
      return;
    }
    if (isRefClause(s.clause) && s.sawDefinition) {
      // reference to this scope's own alias
      edits.push({ start, end, text: renameText(quote) });
      return;
    }
    // Otherwise a projection expr / function arg / WHERE / cross-scope ref — its
    // fate depends on whether the scope's FROM is a renamed sub-query.
    const inProjection = s.clause === CLAUSE_SELECT;
    if (s.fromRenamed === true) {
      edits.push({ start, end, text: renameText(quote) });
      if (inProjection) s.outputRenamed = true;
    } else if (s.fromRenamed === false) {
      if (!s.sawDefinition) keptRef = true;
    } else {
      s.deferred.push({ start, end, quote, inProjection });
    }
  };

  while (i < n) {
    const ch = sql[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Quoted identifier ("…") or string literal ('…') — scanned as one token.
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && sql[j] !== ch) j++;
      const closed = j < n;
      const inner = sql.slice(i + 1, j);
      if (closed && inner === tsCol) {
        handleTs(i, j + 1, ch, prevNonSpace === ".");
      }
      top().expectAlias = false;
      prevNonSpace = ch;
      i = closed ? j + 1 : n;
      continue;
    }

    if (ch === "(") {
      if (opensSubquery(i + 1)) {
        const parent = top();
        stack.push(newScope(parent.clause === CLAUSE_FROM));
        parens.push({ isSubquery: true, savedClause: CLAUSE_OTHER });
      } else {
        // Transparent paren (function call / grouping / window) — isolate the
        // clause so an inner `OVER (ORDER BY …)` doesn't leak.
        parens.push({ isSubquery: false, savedClause: top().clause });
        top().clause = CLAUSE_OTHER;
      }
      prevNonSpace = "(";
      i++;
      continue;
    }
    if (ch === ")") {
      const p = parens.pop();
      if (p?.isSubquery && stack.length > 1) {
        const child = stack.pop() as Scope;
        if (child.fromRenamed === null) {
          child.fromRenamed = false;
          resolveDeferred(child, false);
        }
        const parent = top();
        if (child.outputRenamed) {
          if (child.parentWasFrom) {
            if (parent.fromRenamed !== true) {
              parent.fromRenamed = true;
              resolveDeferred(parent, true);
            }
          } else {
            cteRenamed = true; // renamed inside a CTE/scalar sub-query — can't track its consumers
          }
        }
      } else if (p && !p.isSubquery) {
        top().clause = p.savedClause; // restore clause after a transparent paren
      }
      prevNonSpace = ")";
      i++;
      continue;
    }

    if (isIdentChar(ch)) {
      let j = i;
      while (j < n && isIdentChar(sql[j])) j++;
      const word = sql.slice(i, j);
      const lower = word.toLowerCase();
      const s = top();
      const prevClause = s.clause;

      switch (lower) {
        case "select":
          s.clause = CLAUSE_SELECT;
          break;
        case "from":
          s.clause = CLAUSE_FROM;
          break;
        case "group":
          s.clause = CLAUSE_GROUP;
          break;
        case "having":
          s.clause = CLAUSE_HAVING;
          break;
        case "order":
          s.clause = CLAUSE_ORDER;
          break;
        case "by":
          break; // part of GROUP BY / ORDER BY — keep current clause
        case "as":
          if (s.clause === CLAUSE_SELECT) s.expectAlias = true;
          break;
        case "where":
        case "on":
        case "limit":
        case "offset":
        case "window":
          s.clause = CLAUSE_OTHER;
          break;
        case "union":
        case "except":
        case "intersect":
          s.clause = CLAUSE_OTHER;
          s.sawDefinition = false;
          break;
      }

      // Left the FROM clause without a renaming sub-query → FROM is a real table,
      // so the scope's deferred `_timestamp` refs are the source column.
      if (prevClause === CLAUSE_FROM && s.clause !== CLAUSE_FROM && s.fromRenamed === null) {
        s.fromRenamed = false;
        resolveDeferred(s, false);
      }

      if (lower !== "as" && word === tsCol) {
        handleTs(i, j, "", prevNonSpace === ".");
      }

      if (lower !== "as") s.expectAlias = false;
      prevNonSpace = word[word.length - 1];
      i = j;
      continue;
    }

    // Any other punctuation.
    prevNonSpace = ch;
    top().expectAlias = false;
    i++;
  }

  // Resolve any still-open scopes (top-level / unterminated) as source columns.
  for (const s of stack) {
    if (s.fromRenamed === null) {
      s.fromRenamed = false;
      resolveDeferred(s, false);
    }
  }

  // An alias renamed inside a CTE referenced by name from an outer scope would
  // orphan those refs (a scanner can't match the CTE name) — leave it unchanged.
  if (cteRenamed && keptRef) return sql;
  if (edits.length === 0) return sql;

  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let last = 0;
  for (const e of edits) {
    if (e.start < last) continue; // defensive: skip any overlap
    out += sql.slice(last, e.start) + e.text;
    last = e.end;
  }
  out += sql.slice(last);
  return out;
}

/**
 * Rename `alias === tsCol` to `newAlias` on every field bucket. Renames only the
 * `alias` (never `column`/`args` — those are the source). Skips VRL-derived
 * fields as defense-in-depth (they are not in the SQL, so callers already gate
 * on that). Returns true if anything changed.
 */
function renameReservedAliasInFields(fields: any, tsCol: string, newAlias: string): boolean {
  if (!fields) return false;
  let changed = false;
  const rename = (field: any) => {
    if (field && field.alias === tsCol && !field.isDerived) {
      field.alias = newAlias;
      changed = true;
    }
  };
  for (const key of AXIS_KEYS) {
    const bucket = fields[key];
    if (Array.isArray(bucket)) bucket.forEach(rename);
    else rename(bucket);
  }
  return changed;
}

/**
 * Rewrite panel configs that store a field alias:
 *  - `override_config[].field.value` (per-column formatting keyed by alias)
 *  - drilldown `data.variables[].value` tokens `${row.field["<alias>"]}`
 * Other configs (mark_line, mappings, trellis) do not store a source alias.
 */
function renameReservedAliasInPanelConfig(config: any, tsCol: string, newAlias: string): void {
  if (!config) return;

  if (Array.isArray(config.override_config)) {
    for (const override of config.override_config) {
      if (override?.field && override.field.value === tsCol) {
        override.field.value = newAlias;
      }
    }
  }

  if (Array.isArray(config.drilldown)) {
    const esc = escapeRegExp(tsCol);
    const doubleQuoted = new RegExp(`(row\\.field\\[")${esc}("\\])`, "g");
    const singleQuoted = new RegExp(`(row\\.field\\[')${esc}('\\])`, "g");
    for (const drilldown of config.drilldown) {
      const variables = drilldown?.data?.variables;
      if (!Array.isArray(variables)) continue;
      for (const variable of variables) {
        if (typeof variable?.value === "string") {
          variable.value = variable.value
            .replace(doubleQuoted, `$1${newAlias}$2`)
            .replace(singleQuoted, `$1${newAlias}$2`);
        }
      }
    }
  }
}

/**
 * Collect the output-column names a query already defines — every `AS <name>`
 * alias and every bare projection column — so a replacement alias can avoid
 * colliding with one of them. `tsCol` itself is excluded (it is what we rename).
 */
function collectOutputNames(sql: string, tsCol: string): Set<string> {
  const names = new Set<string>();
  const add = (name: string) => {
    if (name && name !== tsCol) names.add(name);
  };
  const n = sql.length;
  let i = 0;
  let depth = 0; // any paren (function / grouping / sub-query)
  let inSelect = false; // inside a SELECT projection list
  let itemStart = false; // at the start of a projection item (depth 0)
  let prevWordLower = "";

  while (i < n) {
    const ch = sql[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && sql[j] !== ch) j++;
      const inner = sql.slice(i + 1, j);
      if (prevWordLower === "as") add(inner);
      else if (inSelect && depth === 0 && itemStart) add(inner);
      prevWordLower = "";
      itemStart = false;
      i = j < n ? j + 1 : n;
      continue;
    }

    if (ch === "(") {
      depth++;
      prevWordLower = "";
      itemStart = false;
      i++;
      continue;
    }
    if (ch === ")") {
      if (depth > 0) depth--;
      prevWordLower = "";
      itemStart = false;
      i++;
      continue;
    }

    if (isIdentChar(ch)) {
      let j = i;
      while (j < n && isIdentChar(sql[j])) j++;
      const word = sql.slice(i, j);
      const lower = word.toLowerCase();
      let k = j;
      while (k < n && /\s/.test(sql[k])) k++;
      const nextCh = sql[k] || "";

      if (depth === 0 && lower === "select") {
        inSelect = true;
        itemStart = true;
        prevWordLower = lower;
        i = j;
        continue;
      }
      if (
        depth === 0 &&
        (lower === "from" ||
          lower === "where" ||
          lower === "group" ||
          lower === "having" ||
          lower === "order" ||
          lower === "limit" ||
          lower === "offset" ||
          lower === "window" ||
          lower === "union" ||
          lower === "except" ||
          lower === "intersect" ||
          lower === "on")
      ) {
        inSelect = false;
        itemStart = false;
        prevWordLower = lower;
        i = j;
        continue;
      }

      if (prevWordLower === "as" && lower !== "as") {
        add(word); // alias name after AS
      } else if (inSelect && depth === 0 && itemStart && nextCh !== "(" && nextCh !== ".") {
        add(word); // bare projection column (not a function call, not qualified)
      }
      itemStart = false;
      prevWordLower = lower;
      i = j;
      continue;
    }

    // Other punctuation. A top-level comma begins a new projection item.
    itemStart = ch === "," && depth === 0 && inSelect;
    prevWordLower = "";
    i++;
  }

  return names;
}

/**
 * Pick a collision-free replacement alias for `sql`: `base` (`ts`) if the query
 * has no output column by that name, otherwise the first free `base_1`, `base_2`, …
 */
export function pickReplacementAlias(
  sql: string,
  tsCol: string = RESERVED_TS_ALIAS,
  base: string = RESERVED_TS_ALIAS_REPLACEMENT,
): string {
  const taken = collectOutputNames(sql, tsCol);
  if (!taken.has(base)) return base;
  let k = 1;
  while (taken.has(`${base}_${k}`)) k++;
  return `${base}_${k}`;
}

/**
 * Normalize every panel in a dashboard so the reserved timestamp column is never
 * used as an output alias. Idempotent — safe to run on every load.
 *
 * Per query: pick a collision-free replacement alias (`ts`, or `ts_1`/`ts_2`/… if
 * the query already has a `ts` column), then rewrite the SQL string (the source of
 * truth) and — only when the SQL actually aliased the reserved column — the field
 * alias, using that same chosen alias. Alias-referencing panel configs follow only
 * when a field was renamed. This keeps the SQL, field aliases and configs in
 * lock-step, and structurally excludes VRL-derived `_timestamp` fields (never in
 * the SQL). PromQL panels are skipped (SQL-only rule).
 */
export function normalizeReservedTimestampAlias(
  data: any,
  tsCol: string = RESERVED_TS_ALIAS,
  base: string = RESERVED_TS_ALIAS_REPLACEMENT,
): boolean {
  if (!data?.tabs) return false;

  // Whether any alias was rewritten — lets the caller persist the fix (save +
  // re-fetch) only when the dashboard actually changed.
  let changedAny = false;

  for (const tab of data.tabs) {
    if (!tab?.panels) continue;
    for (const panel of tab.panels) {
      if (!panel?.queries) continue;

      // The `_timestamp` output-alias rule is SQL-only — skip PromQL panels.
      if (panel.queryType === "promql" || panel.queryType === "promql-builder") {
        continue;
      }

      let renamedAny = false;
      let chosenAlias = base;
      for (const query of panel.queries) {
        if (typeof query?.query !== "string" || !query.query.includes(tsCol)) continue;

        const chosen = pickReplacementAlias(query.query, tsCol, base);
        const rewritten = rewriteQueryTimestampAlias(query.query, tsCol, chosen);
        if (rewritten !== query.query) {
          query.query = rewritten;
          renameReservedAliasInFields(query.fields, tsCol, chosen);
          renamedAny = true;
          chosenAlias = chosen;
        }
      }

      if (renamedAny) {
        renameReservedAliasInPanelConfig(panel.config, tsCol, chosenAlias);
        changedAny = true;
      }
    }
  }

  return changedAny;
}
