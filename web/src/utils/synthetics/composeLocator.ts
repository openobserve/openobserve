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
 * Building and reading a combined locator.
 *
 * Some elements cannot be found by any single recorded locator. The org
 * switcher is the canonical case: every row emits the same `data-test`, the
 * list is virtualised so an index means "the second RENDERED row", and it is
 * filterable so search changes which rows are in the set. Every candidate is
 * positional, and re-ranking positional candidates cannot help.
 *
 * The intersection of two ambiguous locators, though, is unique — and carries
 * no index at all. That is what this builds.
 *
 * The strings it emits run natively: `page.locator()` parses `internal:and=`
 * and friends, so nothing downstream needs a builder. The probe, the extension
 * player and results display all keep handing `value` to `page.locator()`.
 *
 * **Combining makes a step stricter, not more resilient.** `A ∧ B` breaks if
 * either A or B breaks. What it buys is precision, and — when the index is kept
 * — drift detection. Resilience stays with the ordered list of candidates.
 */

export type CompositeRelation = "and" | "has" | "has_not" | "descendant";

/** A part of a combined locator. `relation` is absent on the first (base) part. */
export interface CompositePart {
  value: string;
  relation?: CompositeRelation;
}

export interface ComposeInput {
  parts: CompositePart[];
  /**
   * Keep the base part's `nth=` index. Off by default: an index is what
   * combining exists to remove. On, it turns the locator into an assertion —
   * the step fails loudly the day the Nth match stops being this element,
   * instead of acting on the wrong one.
   */
  requirePosition?: boolean;
}

/**
 * Relation → the engine it serialises to.
 *
 * Named after Playwright's own operations rather than CSS's, because the stored
 * value IS a Playwright selector string and anyone debugging a monitor reads
 * Playwright's docs. `descendant` is the odd one out and is not JSON-quoted: it
 * is a plain chain, `A >> B`, and it acts on B rather than narrowing A.
 */
const RELATION_ENGINE: Record<Exclude<CompositeRelation, "descendant">, string> = {
  and: "internal:and",
  has: "internal:has",
  has_not: "internal:has-not",
};

/** A trailing positional token on the base part, e.g. `>> nth=1`. */
const TRAILING_NTH = /\s*>>\s*nth=(\d+)\s*$/;

/**
 * Engines that keep or drop the element they are handed, rather than searching.
 *
 * This distinction is not academic — it is the one the Task 0 spike caught.
 * `and` intersects RESULT SETS and runs the inner selector against the document
 * root, so a bare filter engine on the right filters the document, matches
 * nothing, and the intersection is empty. Silently: there is no error, the step
 * just never resolves.
 *
 * A recorded candidate is never a bare filter engine — Playwright's generator
 * always emits a search engine first — so this only catches locators an author
 * typed. `has` expresses the same intent correctly.
 */
const BARE_FILTER_ENGINE = /^\s*internal:(?:has-text|has-not-text|has|has-not)=/;

/** Would this value match nothing if used as the right-hand side of `and`? */
export function isBareFilterEngine(value: string): boolean {
  return BARE_FILTER_ENGINE.test(value);
}

function serializeJoin(part: CompositePart): string {
  const relation = part.relation ?? "and";
  if (relation === "descendant") return ` >> ${part.value}`;
  return ` >> ${RELATION_ENGINE[relation]}=${JSON.stringify(part.value)}`;
}

/**
 * Build the selector string for a combined locator.
 *
 * The base part's `nth=` is re-emitted BEFORE the first join, always. Order
 * inside the string is load-bearing because parts run left to right and `nth`
 * is itself a part: `A >> nth=4 ∧ B` takes A's fifth match and requires it to
 * be B, while `A ∧ B >> nth=4` intersects down to one element and then asks for
 * the fifth, which matches nothing. That second shape is unexpressible here by
 * construction, which is why it needs no error message.
 */
export function composeLocator(input: ComposeInput): string {
  const [base, ...joins] = input.parts;
  if (!base) return "";

  const nth = base.value.match(TRAILING_NTH);
  const head = nth ? base.value.slice(0, nth.index) : base.value;
  const position = nth && input.requirePosition ? ` >> nth=${nth[1]}` : "";

  return head.trim() + position + joins.map(serializeJoin).join("");
}

/** Split on `>>` at the top level only — a quoted engine body is opaque. */
function topLevelParts(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let inString = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (inString) {
      current += ch;
      if (ch === "\\") {
        current += value[++i] ?? "";
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === ">" && value[i + 1] === ">") {
      out.push(current);
      current = "";
      i++;
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((p) => p.trim()).filter(Boolean);
}

const JOIN_TOKEN = /^internal:(and|has-not|has)=(.*)$/s;
const ENGINE_RELATION: Record<string, CompositeRelation> = {
  and: "and",
  has: "has",
  "has-not": "has_not",
};

/**
 * Recover the parts AND relations of a combined locator. Inverse of
 * {@link composeLocator}; `[]` when the value is not combined.
 *
 * Reading it back matters for more than display: `internal:and=` is an internal
 * engine with no public compatibility promise (R2b.f), so if upstream renames
 * one, stored values can be rewritten mechanically rather than by hand.
 */
export function decomposeLocator(value: string): CompositePart[] {
  const tokens = topLevelParts(value);
  if (tokens.length < 2) return [];

  const parts: CompositePart[] = [];
  let base = "";
  for (const token of tokens) {
    const join = token.match(JOIN_TOKEN);
    if (join) {
      let inner: string;
      try {
        inner = JSON.parse(join[2]) as string;
      } catch {
        return [];
      }
      parts.push({ relation: ENGINE_RELATION[join[1]], value: inner });
      continue;
    }
    // Not a join. Before the first one it is still the base; after one it is a
    // `descendant` chain step.
    if (parts.length) parts.push({ relation: "descendant", value: token });
    else base = base ? `${base} >> ${token}` : token;
  }

  if (!parts.length) return [];
  return [{ value: base }, ...parts];
}

export function isCompositeSelector(value: string): boolean {
  return decomposeLocator(value).length > 0;
}

/**
 * True when every part came from the recording, so `and` is provably safe.
 *
 * Playwright verifies each candidate against the target before storing it —
 * `chooseFirstSelector` returns only when `result[0] === targetElement &&
 * result.length === 1` — so every recorded candidate resolves to the same
 * element by construction, and intersecting two sets that both contain exactly
 * the target gives the target.
 *
 * The guarantee is gone the moment an author-written locator joins the mix,
 * which is when the editor has to ask which relation they mean.
 */
export function canDefaultToAnd(parts: CompositePart[], recorded: string[]): boolean {
  const known = new Set(recorded);
  return parts.length > 0 && parts.every((p) => known.has(p.value));
}
