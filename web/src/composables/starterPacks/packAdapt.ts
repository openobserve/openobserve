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

import { queryNeeds } from "./dashboardFit";
import {
  queryRenames,
  renamePromqlLabels,
  renameSqlColumns,
  type FieldRename,
} from "./fieldRewriter";
import {
  checkPromql,
  checkSql,
  filterPromqlStream,
  limitSqlClusters,
  promqlMetricTokens,
  rewriteAlert,
  rewriteDashboard,
  rewriteSql,
  StreamRewriteError,
  type RewriteChecks,
} from "./streamRewriter";
import type { PackBinding, PackFlavourAlert, PackRepair } from "./types";

export interface PackAdaptation {
  repairs: PackRepair[];
  bindings: PackBinding[];
}

type Doc = Record<string, any>;

const NON_QUERY_PANELS = new Set(["html", "markdown"]);
const PANELS_AT_ONCE = 8;

const copyRepairs = (repairs: PackRepair[], stream?: string) =>
  repairs.map((repair) =>
    stream && repair.also?.includes(stream) ? { ...repair, to: stream } : repair,
  );

const filtersOf = (repairs: PackRepair[]) => repairs.filter(({ filter }) => filter);

const filterQuery = async (
  query: string,
  type: "promql" | "sql",
  { to, filter }: PackRepair,
  streamType: string,
  checks: RewriteChecks,
): Promise<string> => {
  const { field, value } = filter!;
  if (type === "promql") return filterPromqlStream(query, to, field, value, checks);
  if (!queryNeeds(query, "sql").streams.has(to)) return query;
  return limitSqlClusters(query, field, [value], [], checks, streamType);
};

const renameQuery = async (
  query: string,
  type: "promql" | "sql",
  renames: FieldRename[],
  streamType: string,
  checks: RewriteChecks,
): Promise<string> => {
  if (!renames.length) return query;
  if (type === "promql") {
    const next = renamePromqlLabels(query, renames);
    if (next !== query) await checkPromql(next, checks);
    return next;
  }
  const next = await renameSqlColumns(query, renames);
  if (next !== query) await checkSql(next, streamType, checks);
  return next;
};

const adaptQuery = async (
  query: string,
  type: "promql" | "sql",
  repairs: PackRepair[],
  streamType: string,
  { bindings, checks, extra }: { bindings: PackBinding[]; checks: RewriteChecks; extra?: string },
): Promise<string> => {
  let next = query;
  for (const repair of filtersOf(repairs)) {
    next = await filterQuery(next, type, repair, streamType, checks);
  }
  const streams = [...queryNeeds(next, type).streams, ...(extra ? [extra] : [])];
  return renameQuery(next, type, queryRenames(streams, bindings, next), streamType, checks);
};

const renameConditionColumns = (node: unknown, map: Map<string, string>) => {
  if (Array.isArray(node)) {
    node.forEach((child) => renameConditionColumns(child, map));
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as Doc;
  if (typeof record.column === "string") record.column = map.get(record.column) ?? record.column;
  renameConditionColumns(record.conditions, map);
};

const addCondition = (condition: Doc, { field, value }: NonNullable<PackRepair["filter"]>) => {
  const group = condition.conditions?.conditions;
  group?.conditions?.push({
    filterType: "condition",
    column: field,
    operator: "=",
    value,
    logicalOperator: "AND",
  });
};

/** A flavour swaps in its own query before anything else reads the alert. */
export const withFlavour = <T extends Doc>(alert: T, flavour?: PackFlavourAlert): T => {
  if (!flavour) return alert;
  const condition = { ...alert.query_condition, promql: flavour.promql };
  return { ...alert, stream_name: flavour.streams[0], query_condition: condition };
};

/** Writes the repairs, filters and bound names into one alert; a query that fails stops it. */
export const adaptAlert = async <T extends Doc>(
  alert: T,
  { repairs, bindings }: PackAdaptation,
  checks: RewriteChecks,
  stream?: string,
): Promise<T> => {
  const own = copyRepairs(repairs, stream);
  const { doc } = await rewriteAlert(alert, own, checks);
  const condition = doc.query_condition ?? {};
  const type = condition.type === "promql" ? "promql" : "sql";
  const key = type === "promql" ? "promql" : "sql";
  const options = { bindings, checks, extra: doc.stream_name };
  if (condition.type === "custom") {
    for (const { to, filter } of filtersOf(own))
      if (to === doc.stream_name) addCondition(condition, filter!);
  }
  if (condition[key]) {
    condition[key] = await adaptQuery(condition[key], type, own, doc.stream_type, options);
  }
  const renames = queryRenames([doc.stream_name], bindings, doc.stream_name);
  const map = new Map(renames.map(({ from, to }) => [from, to]));
  renameConditionColumns(condition.conditions, map);
  const groupBy = condition.aggregation?.group_by;
  if (Array.isArray(groupBy)) {
    condition.aggregation.group_by = groupBy.map((name: string) => map.get(name) ?? name);
  }
  return doc as T;
};

const renameBuilderFields = (node: unknown, map: Map<string, string>) => {
  if (Array.isArray(node)) {
    node.forEach((child) => renameBuilderFields(child, map));
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as Doc;
  for (const key of ["column", "field"]) {
    if (typeof record[key] === "string") record[key] = map.get(record[key]) ?? record[key];
  }
  Object.values(record).forEach((child) => renameBuilderFields(child, map));
};

const adaptPanelQuery = async (
  panel: Doc,
  query: Doc,
  { repairs, bindings }: PackAdaptation,
  checks: RewriteChecks,
) => {
  const type = panel.queryType === "promql" ? "promql" : "sql";
  const fields = query.fields ?? {};
  const streamType = fields.stream_type ?? "logs";
  const text = typeof query.query === "string" ? query.query : "";
  // A custom query keeps a stale `fields.stream`, so only its text says what it reads.
  const extra = query.customQuery ? undefined : fields.stream;
  const options = { bindings, checks, extra };
  if (text) query.query = await adaptQuery(text, type, repairs, streamType, options);
  const named = queryNeeds(query.query ?? "", type).streams;
  const renames = queryRenames([...named, ...(extra ? [extra] : [])], bindings, text);
  renameBuilderFields(fields, new Map(renames.map(({ from, to }) => [from, to])));
};

// A panel that cannot be rewritten honestly goes alone; the fit would drop most of them anyway.
const adaptPanel = async (
  source: Doc,
  adaptation: PackAdaptation,
  checks: RewriteChecks,
): Promise<Doc | null> => {
  try {
    const { doc } = await rewriteDashboard(
      { tabs: [{ panels: [source] }] },
      adaptation.repairs,
      checks,
    );
    const panel = doc.tabs[0].panels[0];
    if (NON_QUERY_PANELS.has(panel.type)) return panel;
    for (const query of panel.queries ?? [])
      await adaptPanelQuery(panel, query, adaptation, checks);
    return panel;
  } catch (error) {
    if (error instanceof StreamRewriteError) return null;
    throw error;
  }
};

const adaptVariable = (variable: Doc, bindings: PackBinding[]) => {
  const data = variable.query_data;
  if (!data?.stream) return;
  const renames = queryRenames([data.stream], bindings, data.stream);
  const map = new Map(renames.map(({ from, to }) => [from, to]));
  data.field = map.get(data.field) ?? data.field;
  for (const filter of data.filter ?? []) filter.name = map.get(filter.name) ?? filter.name;
};

/** Writes the repairs, filters and bound names into a dashboard, so its fit runs on real names. */
export const adaptDashboard = async (
  dashboard: Doc,
  adaptation: PackAdaptation,
  checks: RewriteChecks,
): Promise<Doc> => {
  const shell: Doc = { ...dashboard, tabs: [] };
  const { doc } = await rewriteDashboard(shell, adaptation.repairs, checks);
  doc.tabs = [];
  for (const tab of dashboard.tabs ?? []) {
    const source: Doc[] = tab.panels ?? [];
    const panels: Doc[] = [];
    for (let start = 0; start < source.length; start += PANELS_AT_ONCE) {
      const batch = source.slice(start, start + PANELS_AT_ONCE);
      const adapted = await Promise.all(
        batch.map((panel) => adaptPanel(panel, adaptation, checks)),
      );
      panels.push(...adapted.filter((panel): panel is Doc => panel !== null));
    }
    doc.tabs.push({ ...tab, panels });
  }
  for (const variable of doc.variables?.list ?? []) adaptVariable(variable, adaptation.bindings);
  return doc;
};

/** Plans every SQL panel that survived the fit; one refusal stops the dashboard. */
export const planKeptPanels = async (doc: Doc, checks: RewriteChecks) => {
  for (const tab of doc.tabs ?? []) {
    for (const panel of tab.panels ?? []) {
      if (panel.queryType === "promql" || NON_QUERY_PANELS.has(panel.type)) continue;
      for (const { query, fields } of panel.queries ?? []) {
        if (query) await checkSql(query, fields?.stream_type ?? "logs", checks);
      }
    }
  }
};

const pointQuery = async (panel: Doc, query: Doc, stream: string, name: string) => {
  const token = `$${name}`;
  if (query.fields?.stream === stream) query.fields.stream = token;
  if (typeof query.query !== "string") return;
  if (panel.queryType !== "promql") {
    query.query = await rewriteSql(query.query, [{ from: stream, to: token }]);
    return;
  }
  query.query = promqlMetricTokens(query.query)
    .filter((row) => row.name === stream)
    .sort((left, right) => right.start - left.start)
    .reduce(
      (text, { start, end }) => text.slice(0, start) + token + text.slice(end),
      query.query as string,
    );
};

const streamVariable = (name: string, streams: string[]) => ({
  type: "custom",
  name,
  label: "Stream",
  value: streams[0],
  options: streams.map((value, index) => ({ label: value, value, selected: index === 0 })),
  multiSelect: false,
  scope: "global",
});

/** Runs last, because the server can only plan and parse a query with a real stream name. */
export const addStreamPickers = async (doc: Doc, repairs: PackRepair[]) => {
  const several = repairs.filter(({ also }) => also?.length);
  for (const [index, { to, also }] of several.entries()) {
    const name = `pack_stream_${index + 1}`;
    for (const tab of doc.tabs ?? []) {
      for (const panel of tab.panels ?? []) {
        if (NON_QUERY_PANELS.has(panel.type)) continue;
        for (const query of panel.queries ?? []) await pointQuery(panel, query, to, name);
      }
    }
    doc.variables = { ...doc.variables, list: [...(doc.variables?.list ?? [])] };
    doc.variables.list.push(streamVariable(name, [to, ...(also ?? [])]));
  }
  return doc;
};

const escapeQuotes = (value: string) => value.replace(/'/g, "''");

/** Points a saved view at the repaired stream; a shared stream keeps only the chosen records. */
export const adaptSavedView = (search: Doc, repairs: PackRepair[]): Doc => {
  const next = JSON.parse(JSON.stringify(search));
  const stream = next.data?.stream;
  if (!stream?.selectedStream) return next;
  const applied = repairs.filter(({ from }) => stream.selectedStream.includes(from));
  stream.selectedStream = stream.selectedStream.map(
    (name: string) => applied.find(({ from }) => from === name)?.to ?? name,
  );
  const filters = applied.flatMap(({ filter }) =>
    filter ? [`${filter.field} = '${escapeQuotes(filter.value)}'`] : [],
  );
  if (filters.length) {
    next.data.query = [next.data.query, ...filters].filter(Boolean).join(" AND ");
  }
  return next;
};
