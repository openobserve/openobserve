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
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FIRST_EVENT_BUDGET, cadenceAt } from "./firstEventBudget";

const here = dirname(fileURLToPath(import.meta.url));

describe("FIRST_EVENT_BUDGET", () => {
  it("holds the approved budget", () => {
    expect(FIRST_EVENT_BUDGET).toEqual({
      fastMs: 5000,
      fastUntilMs: 600000,
      slowMs: 30000,
      stopAtMs: 3600000,
      diagnosisAtMs: 120000,
      rejectionsEveryMs: 30000,
    });
    expect(Object.isFrozen(FIRST_EVENT_BUDGET)).toBe(true);
  });

  it("polls fast for ten minutes, slow to sixty, then stops", () => {
    expect(cadenceAt(0)).toBe(5000);
    expect(cadenceAt(599_999)).toBe(5000);
    expect(cadenceAt(600_000)).toBe(30000);
    expect(cadenceAt(3_599_999)).toBe(30000);
    expect(cadenceAt(3_600_000)).toBeNull();
  });

  it("follows a changed budget object, so one edit moves every consumer", () => {
    const budget = { ...FIRST_EVENT_BUDGET, fastMs: 2000, stopAtMs: 1000 };
    expect(cadenceAt(0, budget)).toBe(2000);
    expect(cadenceAt(1000, budget)).toBeNull();
  });

  it("is the only place the watcher, the bar and the notice spell the budget numbers", () => {
    const sources = [
      ...readdirSync(here)
        .filter((f) => !f.endsWith(".spec.ts") && f !== "firstEventBudget.ts")
        .map((f) => join(here, f)),
      join(here, "../../components/ingestion/FirstEventStatus.vue"),
      join(here, "../../components/ingestion/FirstEventStillStuck.vue"),
      join(here, "../../components/ingestion/FirstDataNotice.vue"),
    ];
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/\b(5_?000|30_?000|600_?000|3_?600_?000|120_?000)\b/);
    }
  });
});
