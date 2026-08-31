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

import axe, { type RunOptions, type Result } from "axe-core";

// jsdom has no real layout/rendering, so axe cannot resolve these — it marks
// them "incomplete" rather than failing, but they are excluded explicitly so a
// future axe-core upgrade that starts asserting on them under jsdom fails loud
// rather than silently. `color-contrast` is deliberately out of scope here —
// token contrast has its own suite (lib/styles/tokens/contrast.spec.ts).
const JSDOM_UNSUPPORTED_RULES = ["color-contrast", "target-size", "scrollable-region-focusable"];

const AXE_OPTIONS: RunOptions = {
  rules: Object.fromEntries(JSDOM_UNSUPPORTED_RULES.map((id) => [id, { enabled: false }])),
};

export interface A11yCheckResult {
  violations: Result[];
  incomplete: Result[];
}

// Runs axe-core against a mounted component's root element. Call on an element
// attached to `document.body` (`mount(..., { attachTo: document.body })`) —
// axe-core's visibility checks (e.g. `button-name`'s hidden-content branch)
// need the node in the live document, not a detached tree.
export async function runAxe(node: Element): Promise<A11yCheckResult> {
  const results = await axe.run(node, AXE_OPTIONS);
  return { violations: results.violations, incomplete: results.incomplete };
}

// One-line assertion for the common case. Formats violation nodes' HTML into
// the failure message so a CI failure is diagnosable without re-running axe by
// hand — the raw `AxeResults` object's default stringification is not.
export async function expectNoA11yViolations(node: Element): Promise<void> {
  const { violations } = await runAxe(node);
  if (violations.length === 0) return;
  const detail = violations
    .map((v) => `  [${v.id}] ${v.help}\n${v.nodes.map((n) => `    ${n.html}`).join("\n")}`)
    .join("\n");
  throw new Error(`axe-core found ${violations.length} violation(s):\n${detail}`);
}
