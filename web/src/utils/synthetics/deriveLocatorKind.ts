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

import type { LocatorKind } from "@/types/synthetics";

/**
 * Classify an author-written locator value (spec decision D3).
 *
 * A version-2 locator's `kind` labels the value; it does not parse it. Both
 * consumers resolve a locator by handing `value` straight to `page.locator()` —
 * the probe at `v2runner.ts:140`, the extension via `effectiveSelector` — and read
 * `kind` only when reporting which candidates were tried. So the kind must agree
 * with what the string actually is, and a picker that merely *sets* `kind` would
 * produce silently wrong locators: choosing "Role" and typing `button` stores
 * `{ kind: "role", value: "button" }`, and `button` resolves as a CSS tag selector
 * matching every button on the page.
 *
 * Hence: derive, never pick. The engine is already encoded in the value's prefix.
 *
 * **Pure function of the value alone — no configuration.** A rule for bare
 * attribute selectors (`[data-qa="x"]` → `test_attribute`) was specified and
 * removed: it would need the monitor's `testIdAttr`, which the editor cannot see
 * (it reaches only `journeySuggestions`), and which is mutable config — so
 * the same string would classify differently after someone edited it. A bare
 * attribute selector is also genuinely CSS. The self-describing
 * `internal:testid=` form carries the attribute inside the value and is caught by
 * rule 1, which is what that form exists for.
 *
 * Matching is anchored to the start of the **first `>>` segment**. Chained
 * Playwright selectors join with `>>` and the engine of the whole expression is set
 * by its first segment; a substring search would misread
 * `div >> internal:has-text=…` as `text` when the recorder stored `css`.
 */
export function deriveLocatorKind(value: string): LocatorKind {
  const segment = (value.split(">>")[0] ?? "").trim();

  if (segment.startsWith("internal:testid=")) return "test_attribute";
  if (segment.startsWith("internal:role=") || segment.startsWith("role=")) return "role";
  if (segment.startsWith("internal:text=") || segment.startsWith("text=")) return "text";
  if (segment.startsWith("xpath=") || segment.startsWith("//") || segment.startsWith("(//"))
    return "xpath";

  return "css";
}
