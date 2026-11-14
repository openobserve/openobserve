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

export type StreamFields = Map<string, Set<string>>;

export interface DashboardFit {
  doc: Record<string, any>;
  kept: number;
  dropped: number;
}

interface PanelNeeds {
  streams: Set<string>;
  /** Each needs to exist in only one of the streams, since a join reads several. */
  fields: Set<string>;
  variables: Set<string>;
}

const SQL_WORDS = new Set(
  `select distinct from where and or not in is null like ilike group by order having limit offset
  as on join left right inner outer full cross union all case when then else end asc desc with
  between exists true false interval over partition cast date day hour minute second month year
  nulls first last filter`.split(/\s+/),
);

const PROMQL_WORDS = new Set(
  "by without on ignoring group_left group_right offset bool and or unless".split(" "),
);

const VARIABLE = /\$\{?(\w+)/g;

const LABEL_LIST = /\b(?:by|without|on|ignoring|group_left|group_right)\s*\(([^)]*)\)/gi;

const addAll = <T>(target: Set<T>, values: Iterable<T>) => {
  for (const value of values) target.add(value);
};

const sqlNeeds = (query: string): PanelNeeds => {
  const live = query.replace(/--[^\n]*/g, " ");
  const variables = new Set([...live.matchAll(VARIABLE)].map((match) => match[1]));
  const text = query
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ")
    .replace(VARIABLE, "");
  const local = new Set<string>();
  const streams = new Set<string>();
  for (const [, name] of text.matchAll(/\b(\w+)\s+AS\s*\(/gi)) local.add(name.toLowerCase());
  for (const [, name] of text.matchAll(/\bAS\s+"?(\w+)"?/gi)) local.add(name.toLowerCase());
  for (const [, name, alias] of text.matchAll(/\b(?:FROM|JOIN)\s+"?([\w.-]+)"?(?:\s+(\w+))?/gi)) {
    if (!local.has(name.toLowerCase())) streams.add(name);
    if (alias) local.add(alias.toLowerCase());
  }
  const body = text.replace(/\b(?:FROM|JOIN)\s+"?[\w.-]+"?/gi, " ");
  const fields = new Set<string>();
  for (const [, token] of body.matchAll(/\b([a-zA-Z_]\w*)\b"?(?!\s*[(.])/g)) {
    const lower = token.toLowerCase();
    if (token.startsWith("_") || local.has(lower) || SQL_WORDS.has(lower)) continue;
    fields.add(token);
  }
  return { streams, fields, variables };
};

const promqlNeeds = (query: string): PanelNeeds => {
  const variables = new Set([...query.matchAll(VARIABLE)].map((match) => match[1]));
  const text = query
    .replace(/"[^"]*"|'[^']*'/g, '""')
    .replace(/#[^\n]*/g, " ")
    .replace(VARIABLE, "");
  const streams = new Set<string>();
  const fields = new Set<string>();
  for (const [, labels] of text.matchAll(LABEL_LIST)) {
    addAll(fields, labels.match(/\w+/g) ?? []);
  }
  for (const [, block] of text.matchAll(/\{([^}]*)\}/g)) {
    addAll(
      fields,
      [...block.matchAll(/(\w+)\s*[=!]/g)].map((match) => match[1]),
    );
  }
  const bare = text
    .replace(LABEL_LIST, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\[[^\]]*\]/g, " ");
  for (const [, name] of bare.matchAll(/\b([a-zA-Z_:][\w:]*)\b(?!\s*\()/g)) {
    if (!PROMQL_WORDS.has(name.toLowerCase())) streams.add(name);
  }
  return { streams, fields, variables };
};

/** The streams and fields one query reads. */
export const queryNeeds = (query: string, type: "promql" | "sql"): PanelNeeds =>
  type === "promql" ? promqlNeeds(query) : sqlNeeds(query);

export const panelNeeds = (panel: Record<string, any>): PanelNeeds => {
  const needs: PanelNeeds = { streams: new Set(), fields: new Set(), variables: new Set() };
  for (const query of panel.queries ?? []) {
    const text = String(query.query ?? "");
    const part = queryNeeds(text, panel.queryType === "promql" ? "promql" : "sql");
    addAll(needs.streams, part.streams);
    addAll(needs.fields, part.fields);
    addAll(needs.variables, part.variables);
  }
  return needs;
};

const variableFits = (variable: Record<string, any>, schemas: StreamFields): boolean => {
  const data = variable.query_data;
  if (variable.type !== "query_values" || !data) return true;
  return !!schemas.get(data.stream)?.has(data.field);
};

const panelFits = (panel: Record<string, any>, schemas: StreamFields, gone: Set<string>) => {
  const { streams, fields, variables } = panelNeeds(panel);
  if (!streams.size || [...variables].some((name) => gone.has(name))) return false;
  const known = new Set<string>();
  for (const stream of streams) {
    const columns = schemas.get(stream);
    if (!columns) return false;
    addAll(known, columns);
  }
  return [...fields].every((field) => known.has(field));
};

const overlaps = (a: Record<string, number>, b: Record<string, number>) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Closes the holes dropped panels leave, keeping reading order.
const compact = (panels: Array<Record<string, any>>) => {
  const placed: Array<Record<string, number>> = [];
  const ordered = [...panels].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  return ordered.map((panel) => {
    const layout = { ...panel.layout, y: 0 };
    while (placed.some((other) => overlaps(layout, other))) layout.y += 1;
    placed.push(layout);
    return { ...panel, layout };
  });
};

/** What each panel reads, for the readiness check. */
export const dashboardPanelNeeds = (doc: Record<string, any>): PanelNeeds[] =>
  (doc.tabs ?? []).flatMap((tab: Record<string, any>) => (tab.panels ?? []).map(panelNeeds));

/** Every stream a dashboard could read, so a caller fetches each schema once. */
export const dashboardStreams = (doc: Record<string, any>): string[] => {
  const streams = new Set<string>();
  for (const tab of doc.tabs ?? []) {
    for (const panel of tab.panels ?? []) addAll(streams, panelNeeds(panel).streams);
  }
  for (const variable of doc.variables?.list ?? []) {
    if (variable.query_data?.stream) streams.add(variable.query_data.stream);
  }
  return [...streams];
};

/** Keeps a panel only when every stream, field and variable it reads exists, so none lands empty. */
export const fitDashboard = (doc: Record<string, any>, schemas: StreamFields): DashboardFit => {
  const variables: Array<Record<string, any>> = doc.variables?.list ?? [];
  const gone = new Set(
    variables.filter((item) => !variableFits(item, schemas)).map((item) => item.name),
  );
  let kept = 0;
  let dropped = 0;
  const tabs = (doc.tabs ?? []).flatMap((tab: Record<string, any>) => {
    const panels = (tab.panels ?? []).filter((panel: Record<string, any>) =>
      panelFits(panel, schemas, gone),
    );
    kept += panels.length;
    dropped += (tab.panels ?? []).length - panels.length;
    return panels.length ? [{ ...tab, panels: compact(panels) }] : [];
  });
  const list = variables.filter((item) => !gone.has(item.name));
  return { doc: { ...doc, tabs, variables: { ...doc.variables, list } }, kept, dropped };
};
