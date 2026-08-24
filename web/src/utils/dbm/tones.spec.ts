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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DBM_SOFT_TONES, DBM_STATUS_TONES, DBM_TONE_ICONS } from "./tones";

const here = dirname(fileURLToPath(import.meta.url));

const read = (path: string) => readFileSync(join(here, path), "utf8");

describe("DBM tone maps", () => {
  /**
   * Soft badges are claims the PRODUCT made — an insight, a recommendation, a
   * derived row property. Every one of them reaches its colour through the
   * registered `--color-badge-*-soft-*` tokens, so a theme switch moves all of
   * them together.
   */
  it("paints the product's own claims in soft badge tokens", () => {
    expect(DBM_SOFT_TONES).toEqual({
      error: "bg-badge-error-soft-bg text-badge-error-soft-text",
      warning: "bg-badge-warning-soft-bg text-badge-warning-soft-text",
      info: "bg-badge-blue-soft-bg text-badge-blue-soft-text",
      new: "bg-badge-primary-soft-bg text-badge-primary-soft-text",
    });
  });

  /**
   * Status pills are a state the DATABASE is in, and are a DIFFERENT palette on
   * purpose — solid, found while scanning past. Collapsing the two families
   * would either shout every insight or hide every root blocker.
   */
  it("paints database states in solid status tokens, not badge ones", () => {
    expect(DBM_STATUS_TONES).toEqual({
      error: "bg-status-error-bg text-status-error-text",
      warning: "bg-status-warning-bg text-status-warning-text",
      neutral: "bg-surface-subtle text-text-secondary",
    });

    for (const tone of Object.values(DBM_STATUS_TONES)) {
      expect(tone).not.toContain("badge-");
    }
  });

  /** The glyph travels with the colour: a warning chip wearing the error glyph is the bug. */
  it("pairs each severity with its own glyph", () => {
    expect(DBM_TONE_ICONS).toEqual({ error: "error", warning: "trending-up", info: "insights" });
  });

  /**
   * The point of the module. Four literal copies of these pairs lived across
   * two components and three pages, which is how a fifth caller invents a fifth
   * teal — so nobody may spell the tokens out again.
   */
  it.each([
    "../../components/dbm/DbmRowChips.vue",
    "../../components/dbm/DbmInsightStrip.vue",
    "../../views/DatabaseMonitoring/TableHealthPage.vue",
    "../../views/DatabaseMonitoring/BlockedQueriesPage.vue",
    "../../views/DatabaseMonitoring/DeadlocksPage.vue",
  ])("%s reaches its tones through this module", (path) => {
    const source = read(path);

    expect(source).toContain('from "@/utils/dbm/tones"');
    expect(source).not.toMatch(/"bg-badge-\w+-soft-bg text-badge-\w+-soft-text"/);
    expect(source).not.toMatch(/"bg-status-(?:error|warning)-bg text-status-\w+-text"/);
  });
});
