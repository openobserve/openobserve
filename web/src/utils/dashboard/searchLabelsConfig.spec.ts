// Copyright 2023 OpenObserve Inc.
//
// Licensed under the GNU Affero General Public License, Version 3.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.gnu.org/licenses/agpl-3.0.en.html
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect } from "vitest";
import {
  ORDERED_SECTION_IDS,
  DEFAULT_EXPANDED_SECTIONS,
} from "./searchLabelsConfig";

describe("searchLabelsConfig", () => {
  const EXPECTED_SECTIONS = [
    "general",
    "geographic",
    "legend",
    "data",
    "axis",
    "labels",
    "lineStyle",
    "table",
    "pivotTable",
    "valueTransformations",
    "fieldOverrides",
    "map",
    "gauge",
    "layout",
    "colors",
    "drilldown",
    "comparison",
    "markLines",
    "background",
  ] as const;

  describe("ORDERED_SECTION_IDS", () => {
    it("contains all 18 section IDs", () => {
      expect(ORDERED_SECTION_IDS).toHaveLength(19);
    });

    it("contains every expected section ID", () => {
      for (const id of EXPECTED_SECTIONS) {
        expect(ORDERED_SECTION_IDS).toContain(id);
      }
    });

    it("preserves the canonical order", () => {
      expect(ORDERED_SECTION_IDS).toEqual([...EXPECTED_SECTIONS]);
    });

    it("has no duplicate entries", () => {
      const unique = new Set(ORDERED_SECTION_IDS);
      expect(unique.size).toBe(ORDERED_SECTION_IDS.length);
    });
  });

  describe("DEFAULT_EXPANDED_SECTIONS", () => {
    it("has an entry for every section in ORDERED_SECTION_IDS", () => {
      for (const id of ORDERED_SECTION_IDS) {
        expect(DEFAULT_EXPANDED_SECTIONS).toHaveProperty(id);
      }
    });

    it("defaults every section to true", () => {
      for (const id of ORDERED_SECTION_IDS) {
        expect(DEFAULT_EXPANDED_SECTIONS[id]).toBe(true);
      }
    });

    it("has exactly 18 keys", () => {
      expect(Object.keys(DEFAULT_EXPANDED_SECTIONS)).toHaveLength(19);
    });

    it("has no section set to false", () => {
      const falseEntries = Object.entries(DEFAULT_EXPANDED_SECTIONS).filter(
        ([, v]) => v === false,
      );
      expect(falseEntries).toHaveLength(0);
    });
  });
});
