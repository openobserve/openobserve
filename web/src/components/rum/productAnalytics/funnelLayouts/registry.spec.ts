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

import { afterEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { FUNNEL_LAYOUTS, funnelLayoutName } from "./registry";

const SRC = resolve(__dirname, "../../../..");
// Read from the registry, so deleting a layout and its line leaves this spec green.
const LAYOUTS = Object.keys(FUNNEL_LAYOUTS);

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });

const importsOf = (file: string): string[] => {
  const text = readFileSync(file, "utf8");
  const specs = [
    ...text.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...text.matchAll(/\bimport\s+["']([^"']+)["']/g),
  ].map((m) => m[1]);
  return specs.map((s) =>
    s.startsWith("@/") ? join(SRC, s.slice(2)) : s.startsWith(".") ? resolve(dirname(file), s) : s,
  );
};

describe("funnel layout registry", () => {
  afterEach(() => {
    delete window._o2_paFunnelLayout;
  });

  it("an unset choice falls back to the first layout, inline", () => {
    expect(funnelLayoutName(window._o2_paFunnelLayout)).toBe("inline");
    expect(Object.keys(FUNNEL_LAYOUTS)[0]).toBe("inline");
  });

  it("an unknown or non-string choice falls back to inline", () => {
    window._o2_paFunnelLayout = "sideways";
    expect(funnelLayoutName(window._o2_paFunnelLayout)).toBe("inline");
    expect(funnelLayoutName(42)).toBe("inline");
    expect(funnelLayoutName("toString")).toBe("inline");
  });

  it.each(LAYOUTS)("the known choice %s is kept", (name) => {
    window._o2_paFunnelLayout = name;
    expect(funnelLayoutName(window._o2_paFunnelLayout)).toBe(name);
  });

  // A cold import transforms every part a layout pulls in, which outlasts the default 5 s under a full run.
  it("every registry entry loads a component", { timeout: 30000 }, async () => {
    for (const load of Object.values(FUNNEL_LAYOUTS)) {
      expect((await load()).default).toBeTruthy();
    }
  });

  it.each(LAYOUTS)("the %s layout never imports from another layout's folder", (layout) => {
    const own = join(__dirname, layout);
    const others = LAYOUTS.filter((l) => l !== layout).map((l) => join(__dirname, l) + sep);
    const files = filesUnder(own);
    expect(files.length).toBeGreaterThan(0);
    const crossing = files.flatMap((f) =>
      importsOf(f)
        .filter((target) => others.some((o) => (target + sep).startsWith(o)))
        .map((target) => `${relative(SRC, f)} -> ${relative(SRC, target)}`),
    );
    expect(crossing).toEqual([]);
  });
});
