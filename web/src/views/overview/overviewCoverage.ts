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

import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";

import type { AlertCoverage } from "@/composables/contextProviders/types";

/** `alertsListQuery` reads at most this many rows; a full page may hide the covering alert. */
export const ALERT_LIST_CAP = 1000;

const SERVICE_COLUMNS = new Set(["service_name", "service", "service.name"]);

const WATCHED_STREAM_TYPES = new Set(["logs", "metrics", "traces"]);

/** The fields of `ListAlertsResponseBodyItem` the coverage rule reads. */
export interface CoverageAlert {
  alert_id?: string;
  name?: string;
  enabled?: boolean;
  stream_type?: string | null;
  condition?: {
    type?: string;
    sql?: string | null;
    promql?: string | null;
    conditions?: unknown;
  } | null;
}

type Verdict = "covered" | "unknown" | null;

type Node = Record<string, unknown>;

/** One alert's condition, parsed once, answering for any service. */
type CompiledAlert = (service: string) => Verdict;

interface Matcher {
  label: string;
  op: string;
  value: string;
}

let parser: Parser | null = null;

// Keyed by the list itself: a refetched list is a new array, so a stale parse is never reused.
const compiledLists = new WeakMap<readonly CoverageAlert[], CompiledAlert[]>();

// Literal names joined by `|`; the classes exclude `|` and `.`, so the test is linear and exact.
const LITERAL_ALTERNATION = /^[\w:/ -]+(?:\|[\w:/ -]+)*$/;

/** Covered when any enabled alert's parsed condition pins the service on an AND-only path; `unknown` never guesses. */
export function coverageOf(
  alerts: readonly CoverageAlert[] | null,
  service: string,
): AlertCoverage {
  if (!alerts) return "unknown";
  let unknown = alerts.length >= ALERT_LIST_CAP;
  for (const verdict of compiledAlerts(alerts)) {
    const answer = verdict(service);
    if (answer === "covered") return "covered";
    if (answer === "unknown") unknown = true;
  }
  return unknown ? "unknown" : "none";
}

/** One alert's verdict for one service: `null` when it says nothing about it. */
export function alertVerdict(alert: CoverageAlert, service: string): Verdict {
  return compileAlert(alert)(service);
}

function compiledAlerts(alerts: readonly CoverageAlert[]): CompiledAlert[] {
  let compiled = compiledLists.get(alerts);
  if (!compiled) {
    compiled = alerts.map(compileAlert);
    compiledLists.set(alerts, compiled);
  }
  return compiled;
}

function compileAlert(alert: CoverageAlert): CompiledAlert {
  const silent: CompiledAlert = () => null;
  if (alert.enabled === false || !WATCHED_STREAM_TYPES.has(alert.stream_type ?? "")) return silent;
  const condition = alert.condition;
  if (!condition) return silent;
  if (condition.type === "sql") return compileSql(condition.sql ?? "");
  if (condition.type === "promql") return compilePromql(condition.promql ?? "");
  if (condition.type === "custom") {
    const conditions = condition.conditions;
    return (service) => customVerdict(conditions, service);
  }
  return silent;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameValue(value: unknown, service: string, ignoreCase: boolean): boolean {
  if (typeof value !== "string") return false;
  return ignoreCase ? value.toLowerCase() === service.toLowerCase() : value === service;
}

function leafVerdict(leaf: Node, service: string, andOnly: boolean): Verdict {
  const column = typeof leaf.column === "string" ? leaf.column : "";
  if (!SERVICE_COLUMNS.has(column) || leaf.operator !== "=") return null;
  if (!sameValue(leaf.value, service, leaf.ignore_case === true)) return null;
  return andOnly ? "covered" : "unknown";
}

function merge(verdicts: Verdict[]): Verdict {
  if (verdicts.includes("covered")) return "covered";
  return verdicts.includes("unknown") ? "unknown" : null;
}

function customVerdict(conditions: unknown, service: string): Verdict {
  if (isNode(conditions) && conditions.version === 2) {
    return groupVerdict(conditions.conditions, service, true);
  }
  return treeVerdict(conditions, service, true, 0);
}

// V1: an and/or/not tree, or a legacy array read as a conjunction.
function treeVerdict(node: unknown, service: string, andOnly: boolean, depth: number): Verdict {
  if (depth > 64) return null;
  if (Array.isArray(node)) {
    return merge(node.map((child) => treeVerdict(child, service, andOnly, depth + 1)));
  }
  if (!isNode(node)) return null;
  if (Array.isArray(node.and)) return treeVerdict(node.and, service, andOnly, depth + 1);
  if (Array.isArray(node.or)) {
    return merge(node.or.map((child) => treeVerdict(child, service, false, depth + 1)));
  }
  if ("not" in node) return treeVerdict(node.not, service, false, depth + 1);
  return leafVerdict(node, service, andOnly);
}

// V2: a linear group whose items after the first say how they join the one before.
function groupVerdict(group: unknown, service: string, andOnly: boolean, depth = 0): Verdict {
  if (!isNode(group) || !Array.isArray(group.conditions) || depth > 64) return null;
  const items = group.conditions.filter(isNode);
  const joinedByAnd = items.every(
    (item, index) => index === 0 || String(item.logicalOperator ?? "").toLowerCase() === "and",
  );
  const inner = andOnly && joinedByAnd;
  return merge(
    items.map((item) =>
      item.filterType === "group"
        ? groupVerdict(item, service, inner, depth + 1)
        : leafVerdict(item, service, inner),
    ),
  );
}

function compileSql(sql: string): CompiledAlert {
  let where: unknown;
  try {
    parser ??= new Parser();
    const ast = parser.astify(sql);
    const first: unknown = Array.isArray(ast) ? ast[0] : ast;
    where = isNode(first) ? first.where : undefined;
  } catch {
    return (service) => (sql.includes(`'${service}'`) ? "unknown" : null);
  }
  return (service) => whereVerdict(where, service, true, 0);
}

function columnName(node: unknown): string | null {
  if (!isNode(node) || node.type !== "column_ref") return null;
  const column = node.column;
  if (typeof column === "string") return column;
  const expr = isNode(column) ? column.expr : null;
  return isNode(expr) && typeof expr.value === "string" ? expr.value : null;
}

function stringLiterals(node: unknown): string[] {
  if (!isNode(node)) return [];
  if (node.type === "single_quote_string" && typeof node.value === "string") return [node.value];
  if (node.type === "expr_list" && Array.isArray(node.value)) {
    return node.value.flatMap(stringLiterals);
  }
  return [];
}

function comparisonVerdict(node: Node, service: string, andOnly: boolean): Verdict {
  const operator = String(node.operator ?? "").toUpperCase();
  if (operator !== "=" && operator !== "IN") return null;
  const column = columnName(node.left);
  if (!column || !SERVICE_COLUMNS.has(column)) return null;
  if (!stringLiterals(node.right).includes(service)) return null;
  return andOnly ? "covered" : "unknown";
}

function isNot(node: Node): boolean {
  if (node.type === "unary_expr") return String(node.operator ?? "").toUpperCase() === "NOT";
  if (node.type !== "function" || !isNode(node.name)) return false;
  const parts = Array.isArray(node.name.name) ? node.name.name : [];
  return parts.some((part) => isNode(part) && String(part.value).toUpperCase() === "NOT");
}

function whereVerdict(node: unknown, service: string, andOnly: boolean, depth: number): Verdict {
  if (!isNode(node) || depth > 64) return null;
  if (isNot(node)) {
    const inner = node.type === "unary_expr" ? node.expr : (node.args as Node | undefined)?.value;
    const children = Array.isArray(inner) ? inner : [inner];
    return merge(children.map((child) => whereVerdict(child, service, false, depth + 1)));
  }
  if (node.type !== "binary_expr") return null;
  const operator = String(node.operator ?? "").toUpperCase();
  if (operator === "AND" || operator === "OR") {
    const inner = andOnly && operator === "AND";
    return merge([
      whereVerdict(node.left, service, inner, depth + 1),
      whereVerdict(node.right, service, inner, depth + 1),
    ]);
  }
  return comparisonVerdict(node, service, andOnly);
}

function compilePromql(promql: string): CompiledAlert {
  const scan = promqlMatchers(promql);
  if (scan === null) return (service) => (promql.includes(`"${service}"`) ? "unknown" : null);
  const services = scan.matchers.filter((m) => SERVICE_COLUMNS.has(m.label));
  // A selector's side of `unless` is not tracked, so a pinned service may be the one excluded.
  const exact: Verdict = scan.unless ? "unknown" : "covered";
  return (service) =>
    merge(
      services.map((m) => {
        if (m.op === "=") return m.value === service ? exact : null;
        if (m.op === "=~") return regexVerdict(m.value, service);
        return null;
      }),
    );
}

// A user pattern never runs on the main thread: only a literal alternation is read, any other is unknown.
function regexVerdict(pattern: string, service: string): Verdict {
  if (!LITERAL_ALTERNATION.test(pattern)) return "unknown";
  return pattern.split("|").includes(service) ? "unknown" : null;
}

// Strings and `#` comments are skipped, so a quoted or commented name is never read as a matcher.
function promqlMatchers(text: string): { matchers: Matcher[]; unless: boolean } | null {
  const matchers: Matcher[] = [];
  const word = /[A-Za-z_][\w:]*/y;
  let unless = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(text, i);
      if (end < 0) return null;
      i = end;
    } else if (ch === "{") {
      const end = readSelector(text, i + 1, matchers);
      if (end < 0) return null;
      i = end;
    } else if (/[A-Za-z_]/.test(ch) && !/[\w:]/.test(text[i - 1] ?? "")) {
      word.lastIndex = i;
      const name = word.exec(text)?.[0] ?? ch;
      if (name.toLowerCase() === "unless") unless = true;
      i += name.length;
    } else {
      i++;
    }
  }
  return { matchers, unless };
}

function skipString(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\" && quote !== "`") i++;
    else if (text[i] === quote) return i + 1;
  }
  return -1;
}

function readSelector(text: string, start: number, out: Matcher[]): number {
  const matcher = /\s*([A-Za-z_][\w.]*)\s*(=~|!~|!=|=)\s*/y;
  let i = start;
  while (i < text.length) {
    while (/[\s,]/.test(text[i] ?? "")) i++;
    if (text[i] === "}") return i + 1;
    matcher.lastIndex = i;
    const head = matcher.exec(text);
    if (!head) return -1;
    const valueStart = matcher.lastIndex;
    const end = skipString(text, valueStart);
    if (end < 0 || !`"'\``.includes(text[valueStart] ?? "")) return -1;
    out.push({ label: head[1], op: head[2], value: unquote(text.slice(valueStart, end)) });
    i = end;
  }
  return -1;
}

function unquote(literal: string): string {
  const body = literal.slice(1, -1);
  return literal[0] === "`" ? body : body.replace(/\\(.)/g, "$1");
}
