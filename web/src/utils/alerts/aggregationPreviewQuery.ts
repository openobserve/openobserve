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
  // Remove HAVING clause (and everything after it)
  cleaned = cleaned.replace(/\s+HAVING\s+[\s\S]*$/gi, "");
  // Remove zo_sql_min_time and zo_sql_max_time from SELECT list
  cleaned = cleaned.replace(/,\s*[^,\n]*?\s+[aA][sS]\s+zo_sql_min_time/g, "");
  cleaned = cleaned.replace(/,\s*[^,\n]*?\s+[aA][sS]\s+zo_sql_max_time/g, "");
  // Rename aggregation value aliases to zo_sql_num
  cleaned = cleaned.replace(/\bzo_sql_val\b/g, "zo_sql_num");
  cleaned = cleaned.replace(/\balert_agg_value\b/g, "zo_sql_num");
  // Ensure histogram(...) is aliased as zo_sql_key
  cleaned = cleaned.replace(/\bhistogram\s*\([^)]+\)(?:\s+[aA][sS]\s+\w+)?/g, (match) => {
    if (/\bas\s+zo_sql_key\b/i.test(match)) return match;
    return match.replace(/\s+[aA][sS]\s+\w+$/, "") + " AS zo_sql_key";
  });
  // If zo_sql_key is still absent, inject histogram(_timestamp) AS zo_sql_key
  if (!/\bzo_sql_key\b/i.test(cleaned)) {
    cleaned = cleaned.replace(/\bSELECT\s+/i, "SELECT histogram(_timestamp) AS zo_sql_key, ");
    if (/\bGROUP\s+BY\s+/i.test(cleaned)) {
      // Existing GROUP BY — prepend zo_sql_key to it
      cleaned = cleaned.replace(/\bGROUP\s+BY\s+/i, "GROUP BY zo_sql_key, ");
    } else {
      // No GROUP BY at all — append one before ORDER BY / LIMIT or at end
      if (/\bORDER\s+BY\b/i.test(cleaned)) {
        cleaned = cleaned.replace(/\bORDER\s+BY\b/i, "GROUP BY zo_sql_key ORDER BY");
      } else if (/\bLIMIT\b/i.test(cleaned)) {
        cleaned = cleaned.replace(/\bLIMIT\b/i, "GROUP BY zo_sql_key LIMIT");
      } else {
        cleaned += " GROUP BY zo_sql_key";
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
  const fromMatch = query.match(/\bFROM\b/i);
  if (!fromMatch || !/^\s*SELECT\b/i.test(query)) return null;

  // Keep everything from FROM onward, minus the raw-row tail.
  let tail = query.slice(fromMatch.index as number);
  tail = tail.replace(/\s+ORDER\s+BY\s+[\s\S]*$/i, "");
  tail = tail.replace(/\s+LIMIT\s+[\s\S]*$/i, "");
  tail = tail.replace(/\s+GROUP\s+BY\s+[\s\S]*$/i, "");
  tail = tail.replace(/\s+HAVING\s+[\s\S]*$/i, "");
  tail = tail.trim();
  if (!tail) return null;

  return `SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num ${tail} GROUP BY zo_sql_key`;
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
export const withCompositeGroupLabel = (
  query: string,
  groupBy: string[],
): string | null => {
  const projection = buildGroupLabelProjection(groupBy);
  if (!projection) return null;
  const cols = groupBy.filter((c) => c && c.trim() !== "");

  let out = query;
  // Drop each raw group column from the SELECT list. They are emitted bare
  // (`SELECT zo_sql_key, zo_sql_num, cost_center, availability_zone FROM …`),
  // so match them as standalone list entries rather than anywhere in the text.
  for (const c of cols) {
    out = out.replace(new RegExp(`,\\s*"?${c}"?(?=\\s*(,|\\bFROM\\b))`, "i"), "");
  }
  // Add the composite label to the projection, immediately before FROM.
  out = out.replace(/\s+FROM\s+/i, `, ${projection} FROM `);
  // Same swap in GROUP BY.
  for (const c of cols) {
    out = out.replace(new RegExp(`,\\s*"?${c}"?(?=\\s*(,|$|\\bORDER\\b))`, "i"), "");
  }
  out = out.replace(/\bGROUP\s+BY\s+([^\s,]+)/i, `GROUP BY $1, ${GROUP_LABEL_ALIAS}`);
  // The severity ORDER BY references the aggregate, which is still present;
  // but any trailing order on the raw columns is now dangling.
  out = out.replace(/\s+ORDER\s+BY\s+[\s\S]*$/i, "");
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

