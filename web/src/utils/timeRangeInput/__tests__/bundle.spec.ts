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

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { browserChunks, type ChunkInfo } from "./bundle-helper";

// 20,992 B gzip, set by the user on 2026-11-20; it only ratchets down.
const CORE_LIMIT = 20_992;
const LOCALE_LIMIT = 3 * 1024;
const FIXTURE_LIMIT = 360 * 1024;
const fixture = join(__dirname, "../__fixtures__/corpus.json");

describe("time range parser bundle", () => {
  it("keeps the core and every lazy locale chunk within budget", () => {
    const chunks = browserChunks();
    const lines = chunks.map(
      (c) =>
        `${c.fileName.padEnd(36)} ${String(c.size).padStart(7)} B ${String(c.gzip).padStart(6)} B gzip`,
    );
    process.stdout.write(`${lines.join("\n")}\n`);
    const entry = chunks.find((c) => c.isEntry);
    expect(entry).toBeDefined();
    const packs = (modules: string[]) =>
      modules.filter((id) => /\/packs\/[a-z-]+\.ts$/.test(id) && !id.endsWith("schema.ts"));
    expect(packs(entry?.modules ?? []).map((id) => id.split("/").pop())).toEqual(["en-us.ts"]);
    expect(entry?.gzip ?? Infinity).toBeLessThanOrEqual(CORE_LIMIT);
    // The entry only parses, so the serializer must tree-shake out of the core.
    expect(
      chunks.flatMap((c) => c.modules).filter((id) => id.endsWith("/timeRangeInput/format.ts")),
    ).toEqual([]);
    const lazy = chunks.filter((c) => !c.isEntry);
    const byFile = new Map(chunks.map((c) => [c.fileName, c]));
    const packChunks = lazy.filter((c) => packs(c.modules).length > 0);
    expect(packChunks).toHaveLength(16);
    const closure = (root: ChunkInfo): ChunkInfo[] => {
      const seen = new Map<string, ChunkInfo>();
      const visit = (c: ChunkInfo) => {
        for (const f of c.imports) {
          const d = byFile.get(f);
          if (d && !d.isEntry && !seen.has(f)) {
            seen.set(f, d);
            visit(d);
          }
        }
      };
      visit(root);
      return [...seen.values()];
    };
    const reached = new Set<string>();
    for (const c of lazy) {
      expect(packs(c.modules).length, c.fileName).toBeLessThanOrEqual(1);
      expect(c.gzip, c.fileName).toBeLessThanOrEqual(LOCALE_LIMIT);
    }
    for (const c of packChunks) {
      // A locale loads its chunk plus every helper chunk it reaches, never another pack.
      const deps = closure(c);
      deps.forEach((d) => reached.add(d.fileName));
      expect(
        deps.flatMap((d) => packs(d.modules)),
        c.fileName,
      ).toEqual([]);
      const total = c.gzip + deps.reduce((sum, d) => sum + d.gzip, 0);
      expect(total, c.fileName).toBeLessThanOrEqual(LOCALE_LIMIT);
    }
    // No lazy chunk escapes the budget: each is a pack or a helper some pack statically reaches.
    for (const c of lazy) {
      expect(packChunks.includes(c) || reached.has(c.fileName), c.fileName).toBe(true);
    }
    expect(chunks.flatMap((c) => c.modules).some((id) => id.includes("date-fns"))).toBe(false);
    expect(chunks.some((c) => c.name === "o2cs-date-fns")).toBe(false);
  }, 120_000);

  it("keeps the parser out of a check-and-format-only bundle", () => {
    const modules = browserChunks("check").flatMap((c) => c.modules);
    const names = modules.map((id) => id.split("/timeRangeInput/").pop());
    expect(names).toContain("check.ts");
    expect(names).toContain("format.ts");
    for (const parser of ["phrases.ts", "classify.ts", "combine.ts", "policy.ts", "index.ts"])
      expect(names, parser).not.toContain(parser);
    expect(names.some((n) => n?.startsWith("packs/"))).toBe(false);
  }, 120_000);

  it("keeps the corpus fixture small", () => {
    expect(statSync(fixture).size).toBeLessThanOrEqual(FIXTURE_LIMIT);
    expect(JSON.parse(readFileSync(fixture, "utf8")).length).toBe(628);
  });
});
