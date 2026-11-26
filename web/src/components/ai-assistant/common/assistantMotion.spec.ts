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

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ASSISTANT_MOTION,
  ASSISTANT_MOTION_MS,
  fadeUpClasses,
  openingDurationMs,
  prefersReducedMotion,
  staggerClass,
} from "./assistantMotion";

const here = dirname(fileURLToPath(import.meta.url));

const CSS = readFileSync(join(here, "../../../styles/tailwind.css"), "utf8");

// The body of a top-level `@utility name { … }` or `@keyframes name { … }`, braces balanced.
function block(kind: "@utility" | "@keyframes", name: string): string {
  const head = `${kind} ${name} {`;
  const start = CSS.indexOf(head);
  if (start < 0) return "";
  let depth = 0;
  for (let at = start + head.length - 1; at < CSS.length; at++) {
    if (CSS[at] === "{") depth++;
    if (CSS[at] === "}" && --depth === 0) return CSS.slice(start + head.length, at);
  }
  return "";
}

function reducedBranch(body: string): string {
  const at = body.indexOf("@media (prefers-reduced-motion: reduce)");
  return at < 0 ? "" : body.slice(at);
}

function mockReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: reduce && query.includes("reduce"), media: query })),
  );
}

describe("assistant motion", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defines every named utility in tailwind.css", () => {
    for (const name of Object.values(ASSISTANT_MOTION))
      expect(block("@utility", name)).not.toBe("");
    expect(block("@utility", "assistant-fade-up-*")).toContain("--assistant-stagger-index");
  });

  it.each([ASSISTANT_MOTION.panelIn, ASSISTANT_MOTION.sparkle, ASSISTANT_MOTION.fadeUp])(
    "turns %s into a plain 200 ms fade under reduced motion",
    (name) => {
      const reduced = reducedBranch(block("@utility", name));
      expect(reduced).toContain("animation: assistant-fade 0.2s");
      expect(reduced).not.toMatch(/transform|translate|scale|rotate/);
    },
  );

  it("fades only opacity in the reduced-motion keyframes", () => {
    const fade = block("@keyframes", "assistant-fade");
    expect(fade).toContain("opacity: 0");
    expect(fade).toContain("opacity: 1");
    expect(fade).not.toMatch(/transform|height|--assistant/);
  });

  it("drops the sweep, the wave and the spinner under reduced motion", () => {
    expect(reducedBranch(block("@utility", ASSISTANT_MOTION.sweep))).toContain("display: none");
    for (const name of [ASSISTANT_MOTION.wave, ASSISTANT_MOTION.spin])
      expect(reducedBranch(block("@utility", name))).toContain("animation: none");
  });

  it("plays the opening at the kit's timings", () => {
    expect(block("@utility", ASSISTANT_MOTION.panelIn)).toContain("assistant-panel-in 0.22s");
    expect(block("@utility", ASSISTANT_MOTION.sparkle)).toContain("0.4s");
    expect(block("@utility", ASSISTANT_MOTION.sweep)).toContain(
      "assistant-sweep 1.1s linear 0.2s 1",
    );
    expect(block("@utility", ASSISTANT_MOTION.fadeUp)).toContain(
      `var(--assistant-stagger-index, 0) * ${ASSISTANT_MOTION_MS.stagger}ms`,
    );
    expect(block("@keyframes", "assistant-panel-in")).toContain("translateX(1rem)");
  });

  it("staggers by position and clamps past the last step", () => {
    expect(staggerClass(0)).toBe("assistant-fade-up-0");
    expect(staggerClass(3)).toBe("assistant-fade-up-3");
    expect(staggerClass(-2)).toBe("assistant-fade-up-0");
    expect(staggerClass(40)).toBe("assistant-fade-up-7");
    expect(staggerClass(Number.NaN)).toBe("assistant-fade-up-0");
    expect(fadeUpClasses(2)).toEqual(["assistant-fade-up", "assistant-fade-up-2"]);
  });

  it("reads the system's reduced-motion setting", () => {
    mockReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    mockReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("ends the opening after the sweep, or after the fade alone under reduced motion", () => {
    expect(openingDurationMs(5, false)).toBe(
      ASSISTANT_MOTION_MS.sweepDelay + ASSISTANT_MOTION_MS.sweep,
    );
    expect(openingDurationMs(5, true)).toBe(ASSISTANT_MOTION_MS.reducedFade);
    mockReducedMotion(true);
    expect(openingDurationMs(5)).toBe(ASSISTANT_MOTION_MS.reducedFade);
  });
});
