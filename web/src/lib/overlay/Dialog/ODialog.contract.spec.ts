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
 * ODialog's call-site contract, enforced.
 *
 * Seven dialogs in one feature shipped broken in two different ways, and both
 * were invisible to lint, to types and to every test:
 *
 *   - Four bound `v-model`. ODialog has `open` and NO `modelValue`, so the
 *     binding went nowhere and the dialogs could not be opened at all — one of
 *     them was Resolve, the primary action of the primary screen.
 *   - Three passed `primary-label` / `secondary-label` / `primary-disabled`.
 *     The real names are `primaryButtonLabel` / `secondaryButtonLabel` /
 *     `primaryButtonDisabled`, so `hasFooter` saw nothing and the footer never
 *     rendered: no Save button, no Cancel button.
 *
 * An unknown prop is a plain attribute and Vue says nothing about it, which is
 * why a screen-by-screen audit missed all seven — a dialog that will not open
 * looks like a button wired to nothing, and a missing footer looks like a
 * design decision. The stub half of this is guarded in
 * `components/oncall/stubs.contract.spec.ts`; this is the call-site half.
 *
 * App-wide on purpose. The bugs were all in on-call, but the trap belongs to
 * the component, and the next feature to use it starts from zero knowledge.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Resolved from this file rather than from `process.cwd()`: a suite run from
// the repo root instead of `web/` would otherwise find no components and
// "pass" by checking nothing.
const WEB_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/// Props that LOOK right and silently do nothing, with what to write instead.
const WRONG_PROPS: Record<string, string> = {
  "primary-label": "primary-button-label",
  "secondary-label": "secondary-button-label",
  "neutral-label": "neutral-button-label",
  "primary-disabled": "primary-button-disabled",
  "secondary-disabled": "secondary-button-disabled",
  "primary-loading": "primary-button-loading",
  "secondary-loading": "secondary-button-loading",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith(".vue")) out.push(path);
  }
  return out;
}

/** Every `<ODialog …>` opening tag in a file, as raw text. */
function dialogTags(source: string): string[] {
  const tags: string[] = [];
  const re = /<ODialog\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const end = source.indexOf(">", match.index);
    tags.push(source.slice(match.index, end === -1 ? source.length : end));
  }
  return tags;
}

const callSites = walk(WEB_SRC)
  .map((file) => ({ file: file.slice(WEB_SRC.length + 1), tags: dialogTags(readFileSync(file, "utf8")) }))
  .filter((entry) => entry.tags.length);

describe("ODialog call sites use the contract ODialog actually has", () => {
  it("finds the dialogs it is meant to be guarding", () => {
    // If this collapses to nothing, the guard is guarding nothing.
    expect(callSites.length).toBeGreaterThan(3);
  });

  /// `v-model` binds `modelValue`. ODialog does not have one — it is
  /// `v-model:open`, or `:open` with `@update:open`. A plain `v-model` leaves
  /// the dialog permanently shut and nothing anywhere complains.
  it("never binds a v-model ODialog does not have", () => {
    const offenders = callSites.flatMap(({ file, tags }) =>
      tags
        .filter((tag) => /\sv-model\s*=/.test(tag))
        .map((tag) => `${file}: ${tag.replace(/\s+/g, " ").slice(0, 90)}`),
    );
    expect(offenders).toEqual([]);
  });

  /// The button props are `primaryButtonLabel`, not `primaryLabel`. Getting it
  /// wrong renders no footer at all rather than an unstyled one.
  it("names the footer button props the way ODialog declares them", () => {
    const offenders = callSites.flatMap(({ file, tags }) =>
      tags.flatMap((tag) =>
        Object.entries(WRONG_PROPS)
          .filter(([wrong]) => new RegExp(`[\\s:]${wrong}\\s*=`).test(tag))
          .map(([wrong, right]) => `${file}: ${wrong} should be ${right}`),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
