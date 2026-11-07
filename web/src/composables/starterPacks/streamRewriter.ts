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

import useParser from "@/composables/useParser";

export interface StreamRename {
  from: string;
  to: string;
}

export interface PromqlTree {
  [key: string]: unknown;
}

/** The server checks a rewrite can make, passed in so this module stays free of HTTP. */
export interface RewriteChecks {
  sql: (sql: string, streamType: string) => Promise<void>;
  promql: (query: string) => Promise<PromqlTree>;
}

export interface RewriteResult<T> {
  doc: T;
  changed: boolean;
}

interface MetricToken {
  start: number;
  end: number;
  name: string;
  /** Inside a `__name__` matcher's quotes, so a limit must not be added at this spot. */
  quoted: boolean;
}

/** A query could not be rewritten and checked, so its item must not be created half done. */
export class StreamRewriteError extends Error {
  readonly query: string;

  constructor(query: string, cause?: string) {
    super(cause ?? "stream_rewrite_failed");
    this.name = "StreamRewriteError";
    this.query = query;
  }
}

const VARIABLE = /\$\{?\w+(?::\w+)?\}?/g;
const MASK = /o2var(\d+)mask/g;
const IDENTIFIER_START = /[a-zA-Z_:]/;
const IDENTIFIER_PART = /[\w:]/;
const PROMQL_KEYWORDS = new Set([
  "and",
  "bool",
  "by",
  "group_left",
  "group_right",
  "ignoring",
  "offset",
  "on",
  "or",
  "unless",
  "without",
]);
const LABEL_LIST_KEYWORDS = new Set([
  "by",
  "group_left",
  "group_right",
  "ignoring",
  "on",
  "without",
]);
const NON_QUERY_PANELS = new Set(["html", "markdown"]);

// Callers pass reactive objects, which `structuredClone` refuses.
const jsonCopy = (value: unknown): Record<string, any> => JSON.parse(JSON.stringify(value));

// Only the server refusing the query means it does not fit; an outage must stay retryable.
const refusal = (error: any, query: string): unknown => {
  const status = error?.response?.status;
  return status === 400 || status === 422 ? new StreamRewriteError(query, error?.message) : error;
};

const nameMap = (renames: StreamRename[]) => new Map(renames.map(({ from, to }) => [from, to]));

const closingOf = (text: string, from: number, open: string, close: string): number => {
  let depth = 0;
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === '"' || text[index] === "'") {
      index = endOfString(text, index);
    } else if (text[index] === open) {
      depth += 1;
    } else if (text[index] === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length;
};

function endOfString(text: string, from: number): number {
  for (let index = from + 1; index < text.length; index += 1) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === text[from]) return index;
  }
  return text.length;
}

// `__name__="x"` is a stream location too, and the only one inside a selector's braces.
const nameMatcherTokens = (text: string, start: number, end: number): MetricToken[] => {
  const block = text.slice(start, end);
  const tokens: MetricToken[] = [];
  for (const match of block.matchAll(/__name__\s*=\s*(["'])([^"']*)\1/g)) {
    const at = start + (match.index ?? 0) + match[0].length - match[2].length - 1;
    tokens.push({ start: at, end: at + match[2].length, name: match[2], quoted: true });
  }
  return tokens;
};

const skipLabelList = (text: string, from: number): number => {
  let index = from;
  while (/\s/.test(text[index] ?? "")) index += 1;
  return text[index] === "(" ? closingOf(text, index, "(", ")") : from - 1;
};

const nextChar = (text: string, from: number): string => {
  let index = from;
  while (/\s/.test(text[index] ?? "")) index += 1;
  return text[index] ?? "";
};

// `sum by (x) (y)` puts the modifier between an aggregate and its parenthesis.
const opensCall = (text: string, from: number): boolean =>
  nextChar(text, from) === "(" || /^\s*(?:by|without)\b/i.test(text.slice(from));

const skipOffset = (text: string, from: number): number => {
  let index = from;
  while (/[\s\w-]/.test(text[index] ?? "")) {
    if (/\s/.test(text[index]) && index > from && /\w/.test(text[index - 1])) break;
    index += 1;
  }
  return index - 1;
};

/** Every metric name in a PromQL query, by position, so replacing one leaves the rest untouched. */
export const promqlMetricTokens = (text: string): MetricToken[] => {
  const tokens: MetricToken[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      index = endOfString(text, index) + 1;
    } else if (char === "#") {
      const newline = text.indexOf("\n", index);
      index = newline < 0 ? text.length : newline;
    } else if (char === "{") {
      const close = closingOf(text, index, "{", "}");
      tokens.push(...nameMatcherTokens(text, index, close));
      index = close + 1;
    } else if (char === "[") {
      index = text.indexOf("]", index) + 1 || text.length;
    } else if (IDENTIFIER_START.test(char)) {
      let end = index;
      while (IDENTIFIER_PART.test(text[end] ?? "")) end += 1;
      const name = text.slice(index, end);
      const keyword = name.toLowerCase();
      if (LABEL_LIST_KEYWORDS.has(keyword)) {
        end = skipLabelList(text, end) + 1;
      } else if (keyword === "offset") {
        end = skipOffset(text, end) + 1;
      } else if (!PROMQL_KEYWORDS.has(keyword) && !opensCall(text, end)) {
        tokens.push({ start: index, end, name, quoted: false });
      }
      index = end;
    } else if (/\d/.test(char) || char === ".") {
      while (/[\w.+-]/.test(text[index] ?? "") && !/[+-]/.test(text[index + 1] ?? "")) index += 1;
      index += 1;
    } else {
      index += 1;
    }
  }
  return tokens;
};

/** Metric names in a `parse_tree` reply; `complete` is false when a node hides its selectors. */
export const treeMetricNames = (tree: unknown) => {
  const names = new Set<string>();
  let complete = true;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    if (record.type === "unsupported") complete = false;
    if (Array.isArray(record.matchers)) {
      if (typeof record.name === "string" && record.name) names.add(record.name);
      for (const matcher of record.matchers as Array<Record<string, unknown>>) {
        if (matcher.label === "__name__" && matcher.op === "=") names.add(String(matcher.value));
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(tree);
  return { names, complete };
};

// `on(...)` matching parses but the tree hides its selectors, so such a query checks as a subset.
const agrees = (scanned: Set<string>, tree: unknown) => {
  const { names, complete } = treeMetricNames(tree);
  const inScan = [...names].every((name) => scanned.has(name));
  return inScan && (!complete || names.size === scanned.size);
};

const replaceTokens = (
  query: string,
  tokens: MetricToken[],
  replacement: (token: MetricToken) => string,
): string =>
  [...tokens]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (text, token) => text.slice(0, token.start) + replacement(token) + text.slice(token.end),
      query,
    );

// The server tree is the truth; a scan that disagrees with it must not touch the query.
const checkedTokens = async (query: string, checks: RewriteChecks): Promise<MetricToken[]> => {
  const tokens = promqlMetricTokens(query);
  const tree = await checks.promql(query).catch((error) => {
    throw refusal(error, query);
  });
  const scanned = new Set(tokens.map(({ name }) => name));
  if (!agrees(scanned, tree)) throw new StreamRewriteError(query);
  return tokens;
};

const renamedSet = (names: Iterable<string>, map: Map<string, string>) =>
  new Set([...names].map((name) => map.get(name) ?? name));

/** Renames metrics in a PromQL query, checking the result with the server's parser. */
export const rewritePromql = async (
  query: string,
  renames: StreamRename[],
  checks: RewriteChecks,
): Promise<string> => {
  const map = nameMap(renames);
  if (!promqlMetricTokens(query).some(({ name }) => map.has(name))) return query;
  const tokens = await checkedTokens(query, checks);
  const expected = renamedSet(
    tokens.map(({ name }) => name),
    map,
  );
  const result = replaceTokens(query, tokens, ({ name }) => map.get(name) ?? name);
  const tree = await checks.promql(result).catch((error) => {
    throw refusal(error, result);
  });
  if (!agrees(expected, tree)) throw new StreamRewriteError(result);
  return result;
};

const maskVariables = (sql: string) => {
  const found: string[] = [];
  const masked = sql.replace(VARIABLE, (variable) => `o2var${found.push(variable) - 1}mask`);
  return { masked, unmask: (text: string) => text.replace(MASK, (_all, at) => found[Number(at)]) };
};

const cteNames = (ast: Record<string, any>, into: Set<string>) => {
  for (const cte of ast?.with ?? []) {
    const name = cte?.name?.value ?? cte?.name;
    if (typeof name === "string") into.add(name);
  }
};

// Every FROM, JOIN and subquery sits in some `from` array, and the walk reaches them all.
const renameTables = (node: unknown, map: Map<string, string>, shadowed: Set<string>) => {
  if (Array.isArray(node)) {
    node.forEach((child) => renameTables(child, map, shadowed));
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as Record<string, any>;
  if (record.with) cteNames(record, shadowed);
  if (Array.isArray(record.from)) {
    for (const source of record.from) {
      if (typeof source?.table === "string" && !shadowed.has(source.table)) {
        source.table = map.get(source.table) ?? source.table;
      }
    }
  }
  if (record.type === "column_ref" && typeof record.table === "string" && map.has(record.table)) {
    record.table = map.get(record.table);
  }
  Object.values(record).forEach((child) => renameTables(child, map, shadowed));
};

const sqlMentions = (sql: string, renames: StreamRename[]) =>
  renames.some(({ from }) => sql.includes(from));

/** Renames tables through the SQL parser, so a string or column of that name is left alone. */
export const rewriteSql = async (sql: string, renames: StreamRename[]): Promise<string> => {
  if (!sqlMentions(sql, renames)) return sql;
  const parser = await useParser().sqlParser();
  const { masked, unmask } = maskVariables(sql);
  try {
    const ast = parser.astify(masked);
    renameTables(ast, nameMap(renames), new Set());
    return unmask(parser.sqlify(ast, { database: "PostgreSQL" }));
  } catch {
    throw new StreamRewriteError(sql);
  }
};

const escapeLabelValue = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&").replace(/"/g, '\\"');

/** The matcher a cluster limit adds, also how a retry knows it is already there. */
export const clusterMatcher = (label: string, clusters: string[]) =>
  `${label}=~"${clusters.map(escapeLabelValue).join("|")}"`;

// Exact text only, so a matcher an author wrote on the same label survives.
const withoutPromqlLimit = (query: string, matcher: string) =>
  query.split(`{${matcher}}`).join("").split(`${matcher},`).join("");

/** Sets the clusters of every selector (D16), replacing only the limit the pack wrote before. */
export const limitPromqlClusters = async (
  query: string,
  label: string,
  clusters: string[],
  previous: string[],
  checks: RewriteChecks,
): Promise<string> => {
  if (!clusters.length && !previous.length) return query;
  const base = previous.length ? withoutPromqlLimit(query, clusterMatcher(label, previous)) : query;
  const tokens = await checkedTokens(base, checks);
  if (!clusters.length) return base;
  const matcher = clusterMatcher(label, clusters);
  if (!tokens.length || tokens.some(({ quoted }) => quoted)) throw new StreamRewriteError(base);
  const result = [...tokens]
    .sort((left, right) => right.start - left.start)
    .reduce((text, { start, end, name }) => {
      const rest = text.slice(end);
      const brace = rest.match(/^\s*\{\s*(\}?)/);
      if (!brace) return `${text.slice(0, end)}{${matcher}}${rest}`;
      const separator = brace[1] ? "" : ",";
      const inner = rest.slice(brace[0].length - brace[1].length);
      return `${text.slice(0, start)}${name}{${matcher}${separator}${inner}`;
    }, base);
  await checks.promql(result).catch((error) => {
    throw refusal(error, result);
  });
  return result;
};

const sqlLimit = (parser: any, column: string, clusters: string[]) => {
  const list = clusters.map((name) => `'${name.replace(/'/g, "''")}'`).join(", ");
  return parser.astify(`SELECT 1 FROM t WHERE "${column}" IN (${list})`).where;
};

const sameNode = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

// Only a term equal to what the pack wrote goes, so an authored IN on the column survives.
const whereWithoutLimit = (where: Record<string, any> | null, earlier: unknown) => {
  if (!earlier) return where;
  if (sameNode(where, earlier)) return null;
  if (where?.operator === "AND" && sameNode(where.right, earlier)) {
    return { ...where.left, parentheses: false };
  }
  return where;
};

/** Sets the cluster filter of a SQL alert's outer WHERE, replacing only the pack's earlier one. */
export const limitSqlClusters = async (
  sql: string,
  column: string,
  clusters: string[],
  previous: string[],
  checks: RewriteChecks,
  streamType: string,
): Promise<string> => {
  if (!clusters.length && !previous.length) return sql;
  const parser = await useParser().sqlParser();
  const { masked, unmask } = maskVariables(sql);
  let result: string;
  try {
    const ast = parser.astify(masked);
    const earlier = previous.length ? sqlLimit(parser, column, previous) : null;
    const base = whereWithoutLimit(ast.where, earlier);
    const limit = clusters.length ? sqlLimit(parser, column, clusters) : null;
    ast.where =
      base && limit
        ? {
            type: "binary_expr",
            operator: "AND",
            left: { ...base, parentheses: true },
            right: limit,
          }
        : (limit ?? base);
    result = unmask(parser.sqlify(ast, { database: "PostgreSQL" }));
  } catch (error: any) {
    throw new StreamRewriteError(sql, error?.message);
  }
  await checkSql(result, streamType, checks);
  return result;
};

const checkSql = async (sql: string, streamType: string, checks: RewriteChecks) => {
  await checks.sql(sql, streamType).catch((error) => {
    throw refusal(error, sql);
  });
};

/** Moves an alert to other streams: its stream, then the query that actually reads it. */
export const rewriteAlert = async <T extends Record<string, any>>(
  alert: T,
  renames: StreamRename[],
  checks: RewriteChecks,
): Promise<RewriteResult<T>> => {
  const doc = jsonCopy(alert);
  const map = nameMap(renames);
  const condition = doc.query_condition ?? {};
  const streamName = map.get(doc.stream_name) ?? doc.stream_name;
  let changed = streamName !== doc.stream_name;
  doc.stream_name = streamName;
  if (condition.type === "promql" && condition.promql) {
    const promql = await rewritePromql(condition.promql, renames, checks);
    changed ||= promql !== condition.promql;
    condition.promql = promql;
  } else if (condition.type === "sql" && condition.sql) {
    const sql = await rewriteSql(condition.sql, renames);
    if (sql !== condition.sql) {
      await checkSql(sql, doc.stream_type, checks);
      changed = true;
    }
    condition.sql = sql;
  }
  return { doc: doc as T, changed };
};

const rewritePanelQuery = async (
  panel: Record<string, any>,
  query: Record<string, any>,
  renames: StreamRename[],
  checks: RewriteChecks,
): Promise<boolean> => {
  const map = nameMap(renames);
  const fields = query.fields ?? {};
  let changed = map.has(fields.stream);
  if (fields.stream) fields.stream = map.get(fields.stream) ?? fields.stream;
  for (const join of query.joins ?? fields.joins ?? []) {
    changed ||= map.has(join.stream);
    join.stream = map.get(join.stream) ?? join.stream;
  }
  const text = query.query;
  if (typeof text !== "string" || !text) return changed;
  const isPromql = panel.queryType === "promql";
  const next = isPromql
    ? await rewritePromql(text, renames, checks)
    : await rewriteSql(text, renames);
  if (next === text) return changed;
  if (!isPromql) await checkSql(next, fields.stream_type ?? "logs", checks);
  query.query = next;
  return true;
};

const renameField = (holder: Record<string, any> | undefined, map: Map<string, string>) => {
  if (!holder || !map.has(holder.stream)) return false;
  holder.stream = map.get(holder.stream);
  return true;
};

/** Moves every stream location in a dashboard; a query that fails stops the whole item. */
export const rewriteDashboard = async <T extends Record<string, any>>(
  dashboard: T,
  renames: StreamRename[],
  checks: RewriteChecks,
): Promise<RewriteResult<T>> => {
  const doc = jsonCopy(dashboard);
  const map = nameMap(renames);
  let changed = false;
  for (const tab of doc.tabs ?? []) {
    for (const panel of tab.panels ?? []) {
      if (NON_QUERY_PANELS.has(panel.type)) continue;
      for (const query of panel.queries ?? []) {
        changed = (await rewritePanelQuery(panel, query, renames, checks)) || changed;
      }
    }
  }
  for (const variable of doc.variables?.list ?? []) {
    changed = renameField(variable.query_data, map) || changed;
  }
  for (const source of doc.annotationSources ?? []) {
    changed = renameField(source, map) || changed;
  }
  return { doc: doc as T, changed };
};
