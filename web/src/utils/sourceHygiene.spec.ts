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

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source files must be TEXT.
 *
 * A raw NUL byte inside a string literal is valid TypeScript. It compiles, it
 * lints, it passes every test — and it makes git classify the whole file as
 * BINARY. The diff then vanishes from code review ("Bin 0 -> 64684 bytes") and
 * some editors refuse to open the file at all.
 *
 * It happened here, hidden inside what looked like a space in a template literal:
 *
 *     `${filter.label}<NUL>${filter.operator}<NUL>${filter.value}`
 *
 * A NUL is a perfectly good SEPARATOR — it cannot occur inside a label name or a
 * matcher value, so the key is collision-proof — but it must be written as the
 * "\u0000" escape, which is plain ASCII in the source and identical at runtime.
 * Nothing else in the toolchain notices the difference. This test is what would
 * have caught it.
 */
describe("source hygiene", () => {
  // Walked with node:fs rather than `glob`. `glob` is not a declared dependency of
  // this package — it resolved only because glob@10 happens to be hoisted into the
  // root node_modules as somebody else's transitive dep, which is a thing that can
  // stop being true on any unrelated `npm install`. A guard that silently stops
  // running is worse than no guard.
  const SOURCE_EXTENSIONS = [".ts", ".js", ".vue"];

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(path));
      else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
        out.push(path);
    }
    return out;
  };

  const FILES = walk("src");

  it("finds source files to check (guards against a broken glob)", () => {
    expect(FILES.length).toBeGreaterThan(500);
  });

  it("contains no raw NUL bytes", () => {
    const offenders = FILES.filter((f) => readFileSync(f).includes(0x00));
    expect(offenders).toEqual([]);
  });

  it("contains no other stray C0 control characters", () => {
    // Tab, LF and CR are legitimate; the rest have no business in source.
    const ALLOWED = new Set([0x09, 0x0a, 0x0d]);
    const offenders: string[] = [];

    for (const file of FILES) {
      for (const byte of readFileSync(file)) {
        if (byte < 0x20 && !ALLOWED.has(byte)) {
          offenders.push(`${file} (0x${byte.toString(16).padStart(2, "0")})`);
          break;
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
