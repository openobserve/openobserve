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
 * Can this inherited variable be overridden on the check?
 *
 * Not for a secret. A check-tier override lands in the old `secure` model,
 * which is a display hint rather than a storage property - so the value would
 * become readable through `get_synthetic`, quietly undoing the write-only
 * guarantee the shared secret was created with. A different credential per
 * check belongs at environment scope.
 */
export function canOverride(variable: ResolvedVariable): boolean {
  return variable.kind !== "secret" && !variable.overridden;
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

/**
 * Names a check references that nothing binds.
 *
 * Surfaced in the editor rather than at run time, where an unbound `{{NAME}}`
 * is now typed verbatim - which is right, because `{{...}}` is not necessarily
 * a variable reference, but it does mean a typo is only visible here.
 */
export function unboundPlaceholders(referenced: string[], resolved: ResolvedVariable[]): string[] {
  const bound = new Set(effectiveVariables(resolved).map((v) => v.name));
  return [...new Set(referenced.filter((name) => !bound.has(name)))].sort();
}
