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

import corpus from "../__fixtures__/corpus.json";
import { parseTimeRangeInput } from "../index";
import { pack as en } from "../packs/en-us";
import { compilePack, type GeneratedTables, type LocalePack } from "../packs/schema";
import { corpusContext, packFor, type CorpusRow } from "./helpers";

const rows = corpus as CorpusRow[];
const hands = import.meta.glob<{ pack: LocalePack; tables: GeneratedTables }>(
  ["../packs/*.ts", "!../packs/schema.ts"],
  {
    eager: true,
  },
);

describe("parse and compile budgets", () => {
  it("parses every corpus row with p95 under 1 ms and max under 20 ms, warm", async () => {
    const times: number[] = [];
    const warm = new Set<string>();
    for (const row of rows) {
      const ctx = corpusContext(row, await packFor(row.locale));
      if (!warm.has(row.locale)) {
        parseTimeRangeInput(ctx);
        warm.add(row.locale);
      }
      // Five runs per row; the fastest of each pair of runs filters scheduler noise from parallel test files.
      for (let i = 0; i < 5; i++) {
        let best = Infinity;
        for (let k = 0; k < 2; k++) {
          const t = performance.now();
          parseTimeRangeInput(ctx);
          best = Math.min(best, performance.now() - t);
        }
        times.push(best);
      }
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    const max = times[times.length - 1];
    process.stdout.write(
      `parse p95 ${p95.toFixed(3)} ms, max ${max.toFixed(3)} ms over ${times.length}\n`,
    );
    expect(p95).toBeLessThan(1);
    expect(max).toBeLessThan(20);
  });

  it("compiles each locale pack in under 5 ms (10 ms on CI)", () => {
    // Best of 10 after a warm-up drops scheduler noise; CI runners are ~2.5x slower than a laptop
    // even at their best, so CI gets 10 ms, still far below a pack that regressed.
    const budget = process.env.CI === "true" ? 10 : 5;
    for (const { pack, tables } of Object.values(hands)) {
      compilePack(pack, tables, en);
      let ms = Infinity;
      for (let i = 0; i < 10; i++) {
        const t = performance.now();
        compilePack(pack, tables, en);
        ms = Math.min(ms, performance.now() - t);
      }
      expect(ms, pack.key).toBeLessThan(budget);
    }
  });
});
