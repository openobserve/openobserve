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

import type { SyntheticsEnvironment, SyntheticsVariable } from "@/types/synthetics";

/** One name in a check's resolved set. Mirrors the server's ResolvedVariableView. */
export interface ResolvedVariable {
  name: string;
  kind: "plain" | "secret";
  /** "global", an environment name, or "check". */
  scope: string;
  overridden: boolean;
  example: string;
  description: string;
  has_value: boolean;
}

/** Rows the check inherits rather than defines - the Inherited group. */
export function inheritedVariables(resolved: ResolvedVariable[]): ResolvedVariable[] {
  return resolved.filter((v) => v.scope !== "check");
}

/**
 * What actually resolves, once the check's own names shadow the shared ones.
 *
 * The shared row still exists - `overridden` marks it - so this is the view the
 * author needs when asking "which value does this step actually get?".
 */
export function effectiveVariables(resolved: ResolvedVariable[]): ResolvedVariable[] {
  const own = new Set(resolved.filter((v) => v.scope === "check").map((v) => v.name));
  return resolved.filter((v) => v.scope === "check" || !own.has(v.name));
}

/** An open `{{` immediately before the cursor, and the partial name after it. */
export interface PlaceholderContext {
  /** Index of the opening `{{`. */
  start: number;
  /** Text typed since the braces, which filters the suggestions. */
  query: string;
}

/**
 * Is the cursor inside an unclosed `{{`?
 *
 * Scans back from the cursor for the nearest `{{`, and gives up on anything
 * that cannot be part of a name - a `}}` means the placeholder is already
 * closed, and whitespace or punctuation means the braces belong to earlier
 * text rather than to what is being typed now.
 */
export function placeholderAtCursor(text: string, cursor: number): PlaceholderContext | null {
  const before = text.slice(0, cursor);
  const open = before.lastIndexOf("{{");
  if (open === -1) return null;
  const query = before.slice(open + 2);
  if (query.includes("}")) return null;
  if (!/^\s?[A-Za-z0-9_]*$/.test(query)) return null;
  return { start: open, query: query.trim() };
}

/**
 * Suggestions for a partial name, most relevant first.
 *
 * Prefix matches rank above substring matches: someone typing `BA` wants
 * `BASE_URL` before `DB_BACKUP`. Matching is case-insensitive for finding, but
 * what gets inserted is the stored name exactly - substitution is an exact key
 * lookup, so inserting the typed case would produce a placeholder that never
 * resolves.
 */
export function suggestPlaceholders(
  resolved: ResolvedVariable[],
  query: string,
  limit = 8,
): ResolvedVariable[] {
  const needle = query.toLowerCase();
  const candidates = effectiveVariables(resolved);
  if (!needle) return candidates.slice(0, limit);

  const prefix: ResolvedVariable[] = [];
  const contains: ResolvedVariable[] = [];
  for (const v of candidates) {
    const name = v.name.toLowerCase();
    if (name.startsWith(needle)) prefix.push(v);
    else if (name.includes(needle)) contains.push(v);
  }
  return [...prefix, ...contains].slice(0, limit);
}

/** Replaces the open `{{…` at `context` with a completed `{{NAME}}`. */
export function applyPlaceholder(
  text: string,
  cursor: number,
  context: PlaceholderContext,
  name: string,
): { text: string; cursor: number } {
  const completed = `{{${name}}}`;
  return {
    text: text.slice(0, context.start) + completed + text.slice(cursor),
    cursor: context.start + completed.length,
  };
}

/** Mirrors the server's cap on one run's resolved set (MAX_VARIABLES). */
export const RESOLVED_VARIABLE_CAP = 50;

/**
 * Every environment's resolved set in one response, keyed by environment name.
 * Mirrors the server's ResolvedVariablesGrouped; `""` keys an unscoped check.
 */
export interface ResolvedVariablesGrouped {
  environments: string[];
  resolved: Record<string, ResolvedVariable[]>;
}

/** One distinct inherited name across every selected environment, for 4b's union view. */
export interface InheritedUnionRow {
  name: string;
  /** Environment names the variable is defined in; empty for a global. */
  envs: string[];
  global: boolean;
  secret: boolean;
  /** A local (check-tier) variable of the same name wins over this one. */
  overridden: boolean;
  /** Per-source value hint: `example` when set, else whether a value exists. */
  hints: { source: string; example: string; has_value: boolean }[];
}

/**
 * The Inherited group's rows: every shared name across the union of the
 * check's environments plus globals, one row per distinct name.
 *
 * Deduped by name — a variable defined in two environments is one row with
 * both sources — and sorted by name, since lookup is the dominant task.
 */
export function inheritedUnion(
  grouped: ResolvedVariablesGrouped,
  localNames: ReadonlySet<string>,
): InheritedUnionRow[] {
  const byName = new Map<string, InheritedUnionRow>();
  for (const env of grouped.environments) {
    for (const v of grouped.resolved[env] ?? []) {
      if (v.scope === "check") continue;
      const row = byName.get(v.name) ?? {
        name: v.name,
        envs: [],
        global: false,
        secret: false,
        overridden: localNames.has(v.name),
        hints: [],
      };
      if (v.scope === "global") {
        row.global = true;
      } else if (!row.envs.includes(v.scope)) {
        row.envs.push(v.scope);
      }
      if (v.kind === "secret") row.secret = true;
      const source = v.scope === "global" ? "global" : v.scope;
      if (!row.hints.some((h) => h.source === source)) {
        row.hints.push({ source, example: v.example, has_value: v.has_value });
      }
      byName.set(v.name, row);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Environments in which a name fails to resolve, for the coverage warning.
 *
 * Computed over the effective sets, so a check-tier variable counts as present
 * everywhere. A single-environment check has no gap to warn about.
 */
export function coverageGaps(grouped: ResolvedVariablesGrouped): Map<string, string[]> {
  const gaps = new Map<string, string[]>();
  if (grouped.environments.length < 2) return gaps;
  const perEnv = grouped.environments.map(
    (env) => new Set(effectiveVariables(grouped.resolved[env] ?? []).map((v) => v.name)),
  );
  const names = new Set(perEnv.flatMap((set) => [...set]));
  for (const name of names) {
    const missing = grouped.environments.filter((_, i) => !perEnv[i].has(name));
    if (missing.length) gaps.set(name, missing);
  }
  return gaps;
}

/** A check-tier variable, as the editor holds one before it is saved. */
export interface LocalVariable {
  name: string;
  value?: string;
  example?: string;
}

/** Whether a row has a value, on the two shapes the wire uses for the two kinds. */
function sharedHasValue(variable: SyntheticsVariable): boolean {
  return variable.kind === "secret" ? Boolean(variable.has_value) : Boolean(variable.value);
}

/** One environment's resolved rows, mirroring the server's `resolved_rows`. */
function rowsForEnvironment(
  environment: SyntheticsEnvironment | null,
  globals: SyntheticsVariable[],
  local: LocalVariable[],
): ResolvedVariable[] {
  const localNames = new Set(local.map((v) => v.name.trim()));
  const scoped = environment?.variables ?? [];
  const scopedNames = new Set(scoped.map((v) => v.name));
  const shared: ResolvedVariable[] = [
    ...globals.map((v) => ({
      name: v.name,
      kind: v.kind,
      scope: "global",
      // A global is overridden by the check, and by an environment row of the
      // same name that applies here - the shadowing rule, per environment.
      overridden: localNames.has(v.name) || scopedNames.has(v.name),
      example: v.example ?? "",
      description: v.description ?? "",
      has_value: sharedHasValue(v),
    })),
    ...scoped.map((v) => ({
      name: v.name,
      kind: v.kind,
      scope: environment?.name ?? "",
      overridden: localNames.has(v.name),
      example: v.example ?? "",
      description: v.description ?? "",
      has_value: sharedHasValue(v),
    })),
  ];
  const own: ResolvedVariable[] = local.map((v) => ({
    name: v.name,
    // The check tier keeps the old `secure` flag, which is a display hint
    // rather than a storage property, so it is reported as plain.
    kind: "plain" as const,
    scope: "check",
    overridden: false,
    example: v.example ?? "",
    description: "",
    has_value: Boolean(v.value),
  }));
  return [...shared, ...own].sort(
    (a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope),
  );
}

/**
 * The resolved set per environment, built from the two list endpoints.
 *
 * `GET /{org}/synthetics/{id}/resolved-variables` is keyed on a stored check,
 * so it cannot answer for one that is still being created, and it does not
 * re-run when the author ticks an environment. Both tiers already arrive as
 * metadata through the environments and globals lists, so the merge runs here
 * against whatever the editor holds, saved or not.
 */
export function buildResolvedGrouped(
  environments: SyntheticsEnvironment[],
  globals: SyntheticsVariable[],
  selectedIds: string[],
  local: LocalVariable[],
): ResolvedVariablesGrouped {
  const selected = selectedIds
    .map((id) => environments.find((env) => env.id === id))
    .filter((env): env is SyntheticsEnvironment => Boolean(env));
  // An id that resolves to nothing is a deleted environment, or one this user
  // cannot read. Both are skipped rather than guessed at, as the server does.
  const groups: (SyntheticsEnvironment | null)[] = selectedIds.length ? selected : [null];

  const resolved: Record<string, ResolvedVariable[]> = {};
  const names: string[] = [];
  for (const environment of groups) {
    const key = environment?.name ?? "";
    names.push(key);
    resolved[key] = rowsForEnvironment(environment, globals, local);
  }
  return { environments: names, resolved };
}
