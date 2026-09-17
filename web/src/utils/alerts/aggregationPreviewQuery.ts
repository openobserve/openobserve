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
 * Blank out the contents of quoted string literals, keeping length and quote
 * characters intact, so a keyword search on the result can't be fooled by a
 * projected or filtered string that happens to contain words like "from" or
 * "having".
 */
const maskStringLiterals = (sql: string): string =>
  sql.replace(
    /'(?:[^']|'')*'|"(?:[^"]|"")*"/g,
    (m) => m[0] + "x".repeat(m.length - 2) + m[m.length - 1],
  );

/**
 * Blank out SQL line and block comments, quote-aware in both directions: a
 * comment marker inside a string literal isn't mistaken for a real comment,
 * and a quote inside a comment isn't mistaken for the start of a string
 * literal. Run before maskStringLiterals — a regex pass can't safely tell
 * the two apart in one direction only.
 */
const maskComments = (sql: string): string => {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      out += ch;
      i++;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            out += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      let j = i;
      while (j < sql.length && sql[j] !== "\n") j++;
      out += "x".repeat(j - i);
      i = j;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      let j = i + 2;
      while (j < sql.length && !(sql[j] === "*" && sql[j + 1] === "/")) j++;
      j = Math.min(j + 2, sql.length);
      out += "x".repeat(j - i);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
};

/**
 * Blank out everything inside parentheses, nesting-aware, so a keyword used
 * inside a function call or subquery — e.g. the FROM in EXTRACT(EPOCH FROM
 * now()) — can't be mistaken for the statement's own FROM/GROUP BY/etc. Run
 * this after maskStringLiterals so a literal's own parens can't miscount
 * depth.
 */
const maskParens = (sql: string): string => {
  let depth = 0;
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "(") {
      depth++;
      out += "x";
    } else if (ch === ")") {
      depth--;
      out += "x";
    } else {
      out += depth > 0 ? "x" : ch;
    }
  }
  return out;
};

/**
 * Same-length mask of `sql` (string literals and parenthesised content
 * blanked out) safe to run clause/column keyword searches against — a match
 * index on the result lines up with the same offset in the original `sql`.
 */
const maskForKeywordSearch = (sql: string): string => maskParens(maskStringLiterals(sql));

/**
 * Run `pattern` (global) against a string-literal-masked copy of `sql` so
 * quoted user text can't match, then apply `replacement` to the real string
 * at the matched positions. Masking preserves length, so positions line up
 * between the two.
 */
const replaceOutsideLiterals = (sql: string, pattern: RegExp, replacement: string): string => {
  const masked = maskStringLiterals(sql);
  let out = "";
  let lastIndex = 0;
  for (const match of masked.matchAll(pattern)) {
    const index = match.index as number;
    out += sql.slice(lastIndex, index) + replacement;
    lastIndex = index + match[0].length;
  }
  return out + sql.slice(lastIndex);
};

/**
 * Turn an alert's generated aggregation SQL into a query a time-series chart
 * can render.
 *
 * The evaluation SQL answers "which groups breach right now": it aggregates
 * over the whole look-back window, filters with `HAVING`, and carries the
 * min/max timestamps the notification payload needs. A chart needs the
 * opposite shape — one bucketed point per group over time, with nothing
 * filtered out, so a group's recovery is visible rather than vanishing.
 *
 * So this:
 *  - drops `HAVING`, otherwise healthy groups disappear from the chart and a
 *    recovery looks identical to a series that ended;
 *  - drops the `zo_sql_min_time` / `zo_sql_max_time` projections, which are
 *    payload plumbing and would render as stray series;
 *  - renames the aggregate to `zo_sql_num` and the time bucket to
 *    `zo_sql_key`, the two aliases the panel renderer binds its axes to;
 *  - injects `histogram(_timestamp)` when the query has no time bucket at all,
 *    since an evaluation query has no reason to carry one.
 *
 * Shared by the alert form's preview and the multi-alert detail chart so the
 * two cannot drift into drawing different things from the same alert.
 */
export const cleanAggregationQuery = (query: string): string => {
  let cleaned = query;
  // Remove HAVING clause (and everything after it). The keyword is located on
  // a masked copy so a condition value that merely contains the word "having"
  // (e.g. a filter value of "alerts having errors") can't be mistaken for the
  // clause and truncate the query mid string-literal.
  const havingMatch = maskForKeywordSearch(cleaned).match(/\s+HAVING\s+/i);
  if (havingMatch && havingMatch.index !== undefined) {
    cleaned = cleaned.slice(0, havingMatch.index);
  }
  // Remove zo_sql_min_time and zo_sql_max_time from SELECT list
  cleaned = cleaned.replace(/,\s*[^,\n]*?\s+[aA][sS]\s+zo_sql_min_time/g, "");
  cleaned = cleaned.replace(/,\s*[^,\n]*?\s+[aA][sS]\s+zo_sql_max_time/g, "");
  // Rename aggregation value aliases to zo_sql_num. Masked so a filter value
  // that happens to spell one of these tokens isn't rewritten too.
  cleaned = replaceOutsideLiterals(cleaned, /\bzo_sql_val\b/g, "zo_sql_num");
  cleaned = replaceOutsideLiterals(cleaned, /\balert_agg_value\b/g, "zo_sql_num");
  // Ensure histogram(...) is aliased as zo_sql_key
  cleaned = cleaned.replace(/\bhistogram\s*\([^)]+\)(?:\s+[aA][sS]\s+\w+)?/g, (match) => {
    if (/\bas\s+zo_sql_key\b/i.test(match)) return match;
    return match.replace(/\s+[aA][sS]\s+\w+$/, "") + " AS zo_sql_key";
  });
  // If zo_sql_key is still absent, inject histogram(_timestamp) AS zo_sql_key.
  // Checked on the masked text so a filter value spelling "zo_sql_key" can't
  // be mistaken for the real alias and suppress the injection. The injected
  // column is always the first SELECT list entry, so the GROUP BY below
  // references it positionally ("1") rather than by that name: if the stream
  // itself has a real column literally named zo_sql_key, naming it in GROUP
  // BY would resolve to that real column instead of this alias, leaving
  // histogram's own _timestamp argument ungrouped and the query rejected by
  // the planner.
  if (!/\bzo_sql_key\b/i.test(maskStringLiterals(cleaned))) {
    cleaned = cleaned.replace(/\bSELECT\s+/i, "SELECT histogram(_timestamp) AS zo_sql_key, ");
    // Locate GROUP BY / ORDER BY / LIMIT on a masked copy so a WHERE-clause
    // literal containing one of these phrases can't be mistaken for the
    // actual clause.
    const groupByMatch = maskForKeywordSearch(cleaned).match(/\bGROUP\s+BY\s+/i);
    if (groupByMatch && groupByMatch.index !== undefined) {
      // Existing GROUP BY — prepend the new column to it, positionally
      const end = groupByMatch.index + groupByMatch[0].length;
      cleaned = cleaned.slice(0, groupByMatch.index) + "GROUP BY 1, " + cleaned.slice(end);
    } else {
      // No GROUP BY at all — append one before ORDER BY / LIMIT or at end
      const orderByMatch = maskForKeywordSearch(cleaned).match(/\bORDER\s+BY\b/i);
      const limitMatch = maskForKeywordSearch(cleaned).match(/\bLIMIT\b/i);
      if (orderByMatch && orderByMatch.index !== undefined) {
        const end = orderByMatch.index + orderByMatch[0].length;
        cleaned =
          cleaned.slice(0, orderByMatch.index) + "GROUP BY 1 ORDER BY" + cleaned.slice(end);
      } else if (limitMatch && limitMatch.index !== undefined) {
        const end = limitMatch.index + limitMatch[0].length;
        cleaned = cleaned.slice(0, limitMatch.index) + "GROUP BY 1 LIMIT" + cleaned.slice(end);
      } else {
        cleaned += " GROUP BY 1";
      }
    }
  }
  // Move zo_sql_num field to sit right after zo_sql_key in the SELECT list.
  // Pattern: remove ", <expr> AS zo_sql_num" from wherever it is, then
  // re-insert it immediately after the zo_sql_key field expression.
  const numFieldMatch = cleaned.match(/,\s*([^,]+?\s+[aA][sS]\s+zo_sql_num)/);
  if (numFieldMatch) {
    const numExpr = numFieldMatch[1].trim();
    // Remove the original occurrence (with its leading comma)
    cleaned = cleaned.replace(numFieldMatch[0], "");
    // Insert right after zo_sql_key field (before the next comma or FROM)
    cleaned = cleaned.replace(/(\bzo_sql_key\b(?:\s*\))?)/i, `$1, ${numExpr}`);
  }
  return cleaned.trim();
};

export default cleanAggregationQuery;

/**
 * Turn a COUNT-family alert's generated SQL into a count-over-time query.
 *
 * A count alert has no aggregation: its generated SQL is
 * `SELECT * FROM stream [WHERE …]`, and what it actually measures is "how many
 * rows matched in the window". So the chart is that count, bucketed — the
 * projection is replaced wholesale while the `WHERE` clause (the alert's
 * conditions) is preserved, because the conditions are the whole point.
 *
 * `ORDER BY` / `LIMIT` are dropped: they order and truncate raw rows, and
 * carrying them into an aggregate query would either fail to parse or silently
 * cut the series short.
 *
 * Returns `null` when the statement is not the simple shape this can safely
 * rewrite — better no chart than a chart of the wrong thing.
 */
export const buildCountChartQuery = (query: string): string | null => {
  if (!query) return null;
  const masked = maskForKeywordSearch(maskComments(query));
  if (!/^\s*SELECT\b/i.test(masked)) return null;
  const fromMatch = masked.match(/\bFROM\b/i);
  if (!fromMatch) return null;
  const fromIndex = fromMatch.index as number;

  // Keep everything from FROM onward, minus the raw-row tail. Cut on the masked
  // text so a literal containing "order by"/"limit"/etc. can't truncate early.
  const maskedTail = masked.slice(fromIndex);
  const cutMatch = maskedTail.match(/\s+(?:ORDER\s+BY|LIMIT|GROUP\s+BY|HAVING)\b/i);
  const cutIndex = cutMatch ? fromIndex + (cutMatch.index as number) : undefined;
  const maskedRowQuery = masked.slice(0, cutIndex);
  // UNION/JOIN change what a single "count of matching rows" even means —
  // rewriting the projection around them would either fail to parse or chart
  // something other than the alert's own row count. No chart beats a wrong one.
  if (/\b(?:UNION|JOIN)\b/i.test(maskedRowQuery)) return null;
  const tail = query.slice(fromIndex, cutIndex).trim();
  if (!tail) return null;

  // GROUP BY references the bucket by position, not by the "zo_sql_key" name:
  // if the stream itself has a real column with that name, naming it here
  // would bind to that real column instead of the histogram alias above.
  return `SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num ${tail} GROUP BY 1`;
};

/** Separator between the parts of a composite group label. */
export const GROUP_LABEL_SEPARATOR = " / ";
/** Alias of the synthetic single-column group label. */
export const GROUP_LABEL_ALIAS = "zo_group_label";

/**
 * Collapse a multi-column `group_by` into ONE labelled column for charting.
 *
 * A grouped alert's identity is the *combination* of its group-by columns —
 * `(cost_center, availability_zone)` is one group, not two — so the chart wants
 * one line per combination, which it already draws. The problem is the NAME:
 * with several breakdown columns the renderer labels each series by only one
 * of them, so two groups sharing that column become indistinguishable lines.
 *
 * Concatenating server-side gives every series its full identity in one
 * column, which the renderer can label unambiguously. Values are cast to
 * VARCHAR first because group-by columns are not always strings.
 *
 * Returns `null` when there is nothing to collapse (0 or 1 columns) — a single
 * column is already its own unambiguous label.
 */
export const buildGroupLabelProjection = (groupBy: string[]): string | null => {
  const cols = (groupBy || []).filter((c) => c && c.trim() !== "");
  if (cols.length < 2) return null;
  const casts = cols.map((c) => `CAST("${c}" AS VARCHAR)`).join(", ");
  return `concat_ws('${GROUP_LABEL_SEPARATOR}', ${casts}) AS ${GROUP_LABEL_ALIAS}`;
};

/**
 * Swap a chart query's raw group-by columns for the single composite label
 * built by [`buildGroupLabelProjection`].
 *
 * Operates on the already-cleaned chart query: the group columns appear both
 * in the projection and in `GROUP BY`, and both have to move together or the
 * statement stops being valid.
 */
export const withCompositeGroupLabel = (query: string, groupBy: string[]): string | null => {
  const projection = buildGroupLabelProjection(groupBy);
  if (!projection) return null;
  const cols = groupBy.filter((c) => c && c.trim() !== "");

  // Bound the SELECT-list edit to the text before FROM, located on a masked
  // copy. A WHERE-clause condition can carry a string literal equal to a
  // group-by column's name (e.g. filtering `service = 'service'`) — matching
  // against the raw query would strip that literal instead of the projected
  // column, so the per-column regexes below only ever see the SELECT list.
  const fromMatch = maskForKeywordSearch(query).match(/\s+FROM\s+/i);
  if (!fromMatch || fromMatch.index === undefined) return null;
  let selectList = query.slice(0, fromMatch.index);
  const afterFrom = query.slice(fromMatch.index + fromMatch[0].length);
  // Drop each raw group column from the SELECT list. They are emitted bare
  // (`SELECT zo_sql_key, zo_sql_num, cost_center, availability_zone FROM …`),
  // so match them as standalone list entries.
  for (const c of cols) {
    selectList = selectList.replace(new RegExp(`,\\s*"?${c}"?(?=\\s*(,|$))`, "i"), "");
  }
  // Add the composite label to the projection, immediately before FROM.
  let out = `${selectList}, ${projection} FROM ${afterFrom}`;

  // Bound the GROUP BY edit to the clause itself, the same way.
  const groupByMatch = maskForKeywordSearch(out).match(/\bGROUP\s+BY\s+/i);
  if (!groupByMatch || groupByMatch.index === undefined) return out.trim();
  const groupByStart = groupByMatch.index + groupByMatch[0].length;
  const clauseTailMasked = maskForKeywordSearch(out).slice(groupByStart);
  const clauseEndMatch = clauseTailMasked.match(/\b(?:ORDER\s+BY|HAVING|LIMIT)\b/i);
  const groupByEnd =
    clauseEndMatch && clauseEndMatch.index !== undefined
      ? groupByStart + clauseEndMatch.index
      : out.length;

  let groupByClause = out.slice(groupByStart, groupByEnd);
  for (const c of cols) {
    groupByClause = groupByClause.replace(new RegExp(`,\\s*"?${c}"?(?=\\s*(,|$))`, "i"), "");
  }
  out =
    out.slice(0, groupByStart) +
    `${groupByClause.trim()}, ${GROUP_LABEL_ALIAS} ` +
    out.slice(groupByEnd);

  // The severity ORDER BY references the aggregate, which is still present;
  // but any trailing order on the raw columns is now dangling. Located on a
  // masked copy so a filter value containing "order by" can't be mistaken
  // for the clause and truncate the query mid string-literal.
  const trailingOrderByMatch = maskForKeywordSearch(out).match(/\s+ORDER\s+BY\s+[\s\S]*$/i);
  if (trailingOrderByMatch && trailingOrderByMatch.index !== undefined) {
    out = out.slice(0, trailingOrderByMatch.index);
  }
  return out.trim();
};

/**
 * A blank dashboard panel, shaped for an alert chart.
 *
 * Lives here rather than in either component so the alert form's preview and
 * the multi-alert detail chart start from the identical panel — legends,
 * tooltip behaviour and axis defaults included. Two copies would look the same
 * on the day they were written and drift afterwards.
 */
export const getDefaultDashboardPanelData: any = () => ({
  data: {
    version: 2,
    id: "",
    type: "line",
    title: "",
    description: "",
    config: {
      show_legends: true,
      legends_position: "bottom",
      unit: "short",
      unit_custom: "",
      promql_legend: "",
      axis_border_show: true,
      connect_nulls: true,
      no_value_replacement: "",
      wrap_table_cells: false,
      table_transpose: false,
      table_dynamic_columns: false,
      base_map: {
        type: "osm",
      },
      map_view: {
        zoom: 1,
        lat: 0,
        lng: 0,
      },
      // Custom chart options for alert preview to prevent tooltip clipping
      custom_chart_options: {
        tooltip: {
          appendToBody: true,
          confine: false,
        },
      },
      mark_line: [],
    },
    queryType: "sql",
    queries: [
      {
        query: "",
        customQuery: false,
        query_fn: null,
        fields: {
          stream: "",
          stream_type: "logs",
          x: [],
          y: [],
          z: [],
          breakdown: [],
          filter: {
            filterType: "group",
            logicalOperator: "AND",
            conditions: [],
          },
          latitude: null,
          longitude: null,
          weight: null,
        },
        config: {
          promql_legend: "",
          layer_type: "scatter",
          weight_fixed: 1,
          limit: 0,
          // gauge min and max values
          min: 0,
          max: 100,
          time_shift: [],
        },
      },
    ],
  },
  layout: {
    splitter: 20,
    querySplitter: 20,
    showQueryBar: false,
    isConfigPanelOpen: false,
    currentQueryIndex: 0,
  },
  meta: {
    parsedQuery: "",
    dragAndDrop: {
      dragging: false,
      dragElement: null,
      dragSource: null,
      dragSourceIndex: null,
      currentDragArea: null,
      targetDragIndex: null,
    },
    errors: {
      queryErrors: [],
    },
    editorValue: "",
    dateTime: { start_time: "", end_time: "" },
    filterValue: <any>[],
    stream: {
      selectedStreamFields: [],
      customQueryFields: [],
      functions: [],
      streamResults: <any>[],
      filterField: "",
    },
  },
});
