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

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { browserChunks } from "@/utils/timeRangeInput/__tests__/bundle-helper";

const SRC = resolve(__dirname, "..");
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;
const EXTENSIONS = ["", ".ts", ".vue", ".js", "/index.ts", "/index.js"];

function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith("@/")
    ? join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  const path = EXTENSIONS.map((ext) => base + ext).find(
    (p) => existsSync(p) && !p.endsWith("/") && /\.(ts|vue|js)$/.test(p),
  );
  return path ?? null;
}

// Every app file reached through static imports, the way the bundler sees them; `import()` is not followed.
function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    for (const [, spec] of code.matchAll(STATIC_IMPORT)) {
      const next = resolveLocal(spec, file);
      if (next) queue.push(next);
    }
  }
  return seen;
}

describe("DateTime bundle boundary", () => {
  it("keeps the parser core, its packs and the bar out of the picker's static imports", () => {
    const graph = [...staticGraph(join(SRC, "components/DateTime.vue"))].map((p) =>
      p.slice(SRC.length + 1),
    );
    const parser = graph.filter((p) => p.startsWith("utils/timeRangeInput/"));

    expect(graph.length).toBeGreaterThan(50);
    expect(graph).toContain("utils/timeRangeShortcut.ts");
    expect(parser.sort()).toEqual(
      expect.arrayContaining(["utils/timeRangeInput/check.ts", "utils/timeRangeInput/format.ts"]),
    );
    for (const banned of ["index.ts", "classify.ts", "phrases.ts", "combine.ts", "policy.ts"])
      expect(parser, banned).not.toContain(`utils/timeRangeInput/${banned}`);
    expect(parser.some((p) => p.includes("/packs/"))).toBe(false);
    expect(graph).not.toContain("components/DateTimeRangeInput.vue");
    expect(graph).not.toContain("composables/useTimeRangeInput.ts");
  });

  it("keeps the gate and serializer the picker imports under 2 KiB gzip", () => {
    const chunks = browserChunks("check");
    const entry = chunks.find((c) => c.isEntry);

    expect(entry?.gzip ?? Infinity).toBeLessThanOrEqual(2 * 1024);
  }, 120_000);
});
