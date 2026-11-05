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

import { gt, raw, type I18nText } from "@/types/i18n";

/** The parser message is cut to one line of this many characters. */
export const PARSE_MESSAGE_CHARS = 160;

/** Unknown field names reported at most; the rest are counted. */
export const MAX_UNKNOWN_FIELDS = 20;

/** Proposals above this size are not parsed on the main thread. */
export const MAX_VALIDATED_CHARS = 50_000;

export type ValidatedLanguage = "sql" | "promql" | "vrl" | "js" | "regex" | "json";

export interface ProposalValidation {
  status: "ok" | "error" | "skipped";
  message?: I18nText;
  unknownFields?: string[];
}

/** What the server already said about the query (`query.validated`); it wins over the client check. */
export interface ServerValidation {
  validated?: boolean;
}

interface SqlParser {
  astify(sql: string): unknown;
}

/** The time column every stream carries even when the host's field list leaves it out. */
const ALWAYS_KNOWN = ["_timestamp"];

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set([")", "]", "}"]);

let parserPromise: Promise<SqlParser | null> | null = null;

/** Parses the proposal with the language's client parser and resolves its fields against the host's loaded schema. */
export async function validateProposal(
  language: ValidatedLanguage,
  text: string,
  schemaFields?: string[],
  server?: ServerValidation,
): Promise<ProposalValidation> {
  if (server?.validated === true) return { status: "ok" };
  const body = text.trim();
  if (!body || body.length > MAX_VALIDATED_CHARS) return { status: "skipped" };
  if (language === "sql") return validateSql(body, schemaFields);
  if (language === "json") return validateJson(body);
  if (language === "regex") return validateRegex(body);
  if (language === "js") return validateJs(body);
  // PromQL and VRL have no client parser in the app: only a broken bracket is reported.
  const unbalanced = unbalancedAt(body, "#");
  return unbalanced ? { status: "error", message: unbalanced } : { status: "skipped" };
}

/** Lets a spec swap the parser; never called by app code. */
export function setSqlParserForTests(parser: SqlParser | null): void {
  parserPromise = Promise.resolve(parser);
}

async function validateSql(body: string, schemaFields?: string[]): Promise<ProposalValidation> {
  const parser = await loadParser();
  if (!parser) return { status: "skipped" };
  let ast: unknown;
  try {
    ast = parser.astify(body);
  } catch (err) {
    return { status: "error", message: raw(firstLine(err)) };
  }
  if (!schemaFields?.length) return { status: "ok" };
  const unknown = unknownFieldsOf(ast, schemaFields);
  return unknown.length ? { status: "error", unknownFields: unknown } : { status: "ok" };
}

function validateJson(body: string): ProposalValidation {
  try {
    JSON.parse(body);
    return { status: "ok" };
  } catch (err) {
    return { status: "error", message: raw(firstLine(err)) };
  }
}

// Custom-chart code is a script body that may `return`; acorn loads only when a JS proposal arrives.
async function validateJs(body: string): Promise<ProposalValidation> {
  let acorn: typeof import("acorn");
  try {
    acorn = await import("acorn");
  } catch {
    const unbalanced = unbalancedAt(body, "//");
    return unbalanced ? { status: "error", message: unbalanced } : { status: "skipped" };
  }
  try {
    acorn.parse(body, { ecmaVersion: "latest", allowReturnOutsideFunction: true });
    return { status: "ok" };
  } catch (err) {
    return { status: "error", message: raw(firstLine(err)) };
  }
}

function validateRegex(body: string): ProposalValidation {
  try {
    new RegExp(body);
    return { status: "ok" };
  } catch (err) {
    return { status: "error", message: raw(firstLine(err)) };
  }
}

async function loadParser(): Promise<SqlParser | null> {
  parserPromise ??= import("@/composables/useParser")
    .then(async (mod) => ((await mod.default().sqlParser()) as SqlParser | undefined) ?? null)
    .catch(() => {
      parserPromise = null;
      return null;
    });
  return parserPromise;
}

/** Column references the schema does not hold; names the query defines itself (aliases, CTEs) are not flagged. */
function unknownFieldsOf(ast: unknown, schemaFields: string[]): string[] {
  const known = new Set([...schemaFields, ...ALWAYS_KNOWN].map((field) => field.toLowerCase()));
  const defined = new Set<string>();
  const refs: string[] = [];
  walk(ast, (node) => {
    if (typeof node.as === "string") defined.add(node.as.toLowerCase());
    if (node.type === "column_ref") {
      const name = columnName(node.column);
      if (name && name !== "*") refs.push(name);
    }
  });
  const unknown: string[] = [];
  for (const name of refs) {
    const key = name.toLowerCase();
    if (known.has(key) || defined.has(key) || unknown.includes(name)) continue;
    unknown.push(name);
    if (unknown.length >= MAX_UNKNOWN_FIELDS) break;
  }
  return unknown;
}

function columnName(column: unknown): string | null {
  if (typeof column === "string") return column;
  if (!column || typeof column !== "object") return null;
  const expr = (column as { expr?: { value?: unknown } }).expr;
  return typeof expr?.value === "string" ? expr.value : null;
}

// Iterative, so a deeply nested AST cannot overflow the stack.
function walk(root: unknown, visit: (node: Record<string, unknown>) => void): void {
  const stack: unknown[] = [root];
  let seen = 0;
  while (stack.length && seen < 100_000) {
    const node = stack.pop();
    seen += 1;
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    const record = node as Record<string, unknown>;
    visit(record);
    for (const value of Object.values(record))
      if (value && typeof value === "object") stack.push(value);
  }
}

/** The first unmatched bracket or unclosed quote, outside strings and line comments; `null` when balanced. */
function unbalancedAt(body: string, comment: string): I18nText | null {
  const open: string[] = [];
  let quote: string | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (body.startsWith(comment, i)) {
      const end = body.indexOf("\n", i);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (OPENERS[ch]) open.push(OPENERS[ch]);
    else if (CLOSERS.has(ch) && open.pop() !== ch)
      return gt("assistant.helper.syntax.unexpected", { char: ch, ...lineCol(body, i) });
  }
  if (quote) return gt("assistant.helper.syntax.unclosed", { char: quote });
  return open.length
    ? gt("assistant.helper.syntax.missing", { char: open[open.length - 1] })
    : null;
}

function lineCol(body: string, index: number): { line: number; column: number } {
  const before = body.slice(0, index).split("\n");
  return { line: before.length, column: before[before.length - 1].length + 1 };
}

function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return (message.split("\n")[0] ?? "").trim().slice(0, PARSE_MESSAGE_CHARS);
}
