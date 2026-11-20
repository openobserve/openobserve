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

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { loadTimeRangeLocale, parseTimeRangeInput } from "../index";
import {
  compilePack,
  compilePattern,
  hasSlotRule,
  type GeneratedTables,
  type LocalePack,
} from "../packs/schema";
import { baseContext, isoUs } from "./helpers";

const hands = import.meta.glob<{ pack: LocalePack; tables: GeneratedTables }>(
  ["../packs/*.ts", "!../packs/schema.ts"],
  {
    eager: true,
  },
);
const generator = join(__dirname, "../../../../scripts/gen-time-range-intl.mjs");
const web = join(__dirname, "../../../..");

function patternsOf(p: LocalePack): string[] {
  return [
    ...p.patterns.lastN,
    ...p.patterns.ago,
    ...p.patterns.since,
    ...Object.keys(p.patterns.weekdayOfWeek ?? {}),
    ...p.rangeTemplates,
    ...p.pointAffixes,
    ...p.clockAffixes,
    ...(p.datePatterns ?? []),
  ];
}

describe("locale packs", () => {
  it("has 17 packs, each compiling with its generated tables", () => {
    expect(Object.keys(hands)).toHaveLength(17);
    for (const { pack, tables } of Object.values(hands)) {
      const compiled = compilePack(pack, tables);
      expect(compiled.key).toBe(pack.key);
      expect(tables.bcp47).toBe(pack.bcp47);
    }
  });

  it("gives every multi-element pattern a slot, so no pack spells out a whole phrase", () => {
    for (const { pack } of Object.values(hands)) {
      for (const p of patternsOf(pack)) {
        expect(hasSlotRule(compilePattern(p, (s) => s)), `${pack.key}: ${p}`).toBe(true);
      }
    }
  });

  it("reads de-DE-14 and de-DE-15 from templates and affixes", async () => {
    const de = await loadTimeRangeLocale("de");
    const read = (text: string) => {
      const r = parseTimeRangeInput(baseContext(de, text));
      return r.state === "valid" ? [r.reading.startUs, r.reading.endUs] : r.state;
    };
    expect(read("von 09:00 bis 11:00 Uhr")).toEqual([
      isoUs("2026-11-17T09:00:00+01:00"),
      isoUs("2026-11-17T11:00:00+01:00"),
    ]);
    expect(read("vom 15. November 2026 bis zum 16. November 2026")).toEqual([
      isoUs("2026-11-15T00:00:00+01:00"),
      isoUs("2026-11-17T00:00:00+01:00"),
    ]);
  });

  it("reads the committed ICU version of every generated file the way --check does", async () => {
    const { committedIcu } = await import(pathToFileURL(generator).href);
    for (const key of Object.keys(hands).map((k) => k.slice(9, -3))) {
      const source = readFileSync(join(__dirname, `../packs/generated/${key}.ts`), "utf8");
      expect(committedIcu(source), key).toMatch(/^\d+(\.\d+)*$/);
    }
  });

  it("keeps generated tables equal to a fresh generator run on the same ICU", async () => {
    const { committedIcu } = await import(pathToFileURL(generator).href);
    const icu = committedIcu(readFileSync(join(__dirname, "../packs/generated/de.ts"), "utf8"));
    if (icu !== process.versions.icu) return;
    const run = spawnSync("node", [generator, "--check"], { cwd: web, encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
  });

  it("matches the committed week start to Intl.Locale#getWeekInfo", () => {
    for (const { tables } of Object.values(hands)) {
      const locale = new Intl.Locale(tables.bcp47) as Intl.Locale & {
        getWeekInfo?: () => { firstDay: number };
      };
      if (!locale.getWeekInfo) continue;
      expect(locale.getWeekInfo().firstDay % 7, tables.bcp47).toBe(tables.firstDay);
    }
  });

  it("returns the same compiled pack on every load", async () => {
    const a = await loadTimeRangeLocale("ja");
    const b = await loadTimeRangeLocale("ja");
    expect(a).toBe(b);
    expect(a.locale).toBe("ja");
  });
});
