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
import { reactive } from "vue";
import {
  fitsSteps,
  moveStep,
  spanFrom,
  toMs,
  newExclusion,
  removeStep,
  removedByStep,
  reorderSteps,
  stepOrder,
  isWholeFunnel,
} from "./funnelEdits";
import type { ExclusionStep, FunnelDef, StepRef } from "@/utils/rum/productAnalyticsQueries";

const p = (key: string): StepRef => ({ kind: "p", key });
const defOf = (steps: StepRef[], x?: ExclusionStep[]): FunnelDef => ({
  steps,
  unit: "sessions",
  window: "session",
  breakdown: null,
  ...(x ? { x } : {}),
});
const A = p("/a");
const B = p("/b");
const C = p("/c");
const D = p("/d");
const OUT = p("/out");

describe("funnelEdits", () => {
  it("moving a step down carries every exclusion's a and b with their steps", () => {
    const def = defOf([A, B, C, D], [{ step: OUT, a: 1, b: 3 }]);
    const edit = moveStep(def, 0, 1)!;
    expect(edit.def.steps).toEqual([B, A, C, D]);
    expect(edit.def.x).toEqual([{ step: OUT, a: 2, b: 3 }]);
    expect(edit.dropped).toEqual([]);
  });

  it("moving a step carries a within row's a", () => {
    const def = defOf([A, B, C], [{ step: OUT, a: 3, withinMs: 5000 }]);
    const edit = moveStep(def, 2, -1)!;
    expect(edit.def.x).toEqual([{ step: OUT, a: 2, withinMs: 5000 }]);
  });

  it("a move that inverts a span drops that exclusion and keeps the rest", () => {
    const keep: ExclusionStep = { step: OUT, a: 1, b: 3 };
    const def = defOf([A, B, C], [{ step: OUT, a: 2, b: 3 }, keep]);
    const edit = moveStep(def, 1, 1)!;
    expect(edit.def.steps).toEqual([A, C, B]);
    expect(edit.dropped).toEqual([{ step: OUT, a: 2, b: 3 }]);
    expect(edit.def.x).toEqual([{ step: OUT, a: 1, b: 2 }]);
  });

  it("a move that puts the excluded page strictly inside its span drops it", () => {
    const x: ExclusionStep = { step: D, a: 1, b: 3 };
    const def = defOf([A, B, C, D], [x]);
    const edit = moveStep(def, 3, -1)!;
    expect(edit.def.steps).toEqual([A, B, D, C]);
    expect(edit.dropped).toEqual([x]);
    expect(edit.def.x).toEqual([]);
  });

  it("a move past either end does nothing", () => {
    expect(moveStep(defOf([A, B]), 0, -1)).toBeNull();
    expect(moveStep(defOf([A, B]), 1, 1)).toBeNull();
  });

  it("a drag reorders by identity, even through reactive proxies, and remaps like a move", () => {
    const def = reactive(defOf([A, B, C], [{ step: OUT, a: 1, b: 2 }])) as FunnelDef;
    const dragged = [def.steps[1], def.steps[2], def.steps[0]];
    const order = stepOrder(def.steps, dragged)!;
    expect(order).toEqual([1, 2, 0]);
    const edit = reorderSteps(def, order);
    expect(edit.def.steps).toEqual([B, C, A]);
    expect(edit.dropped).toEqual([{ step: OUT, a: 1, b: 2 }]);
  });

  it("a drag of equal steps matches each to its own position", () => {
    const twin = p("/a");
    const steps = [A, B, twin];
    expect(stepOrder(steps, [twin, A, B])).toEqual([2, 0, 1]);
    expect(stepOrder(steps, [A, B])).toBeNull();
  });

  it("a definition without x keeps none after a move", () => {
    expect(moveStep(defOf([A, B]), 0, 1)!.def).not.toHaveProperty("x");
  });

  it("removing a step drops the exclusions that used it and shifts the rest", () => {
    const def = defOf(
      [A, B, C, D],
      [
        { step: OUT, a: 1, b: 2 },
        { step: OUT, a: 3, b: 4 },
      ],
    );
    const edit = removeStep(def, 1);
    expect(edit.dropped).toEqual([{ step: OUT, a: 1, b: 2 }]);
    expect(edit.def.x).toEqual([{ step: OUT, a: 2, b: 3 }]);
  });

  it("a new exclusion spans step 1 to the last step and reads as the whole funnel", () => {
    const def = defOf([A, B, C, D]);
    const x = newExclusion(def, OUT);
    expect(x).toEqual({ step: OUT, a: 1, b: 4 });
    expect(isWholeFunnel(x, 4)).toBe(true);
    expect(isWholeFunnel({ step: OUT, a: 2, b: 4 }, 4)).toBe(false);
    expect(isWholeFunnel({ step: OUT, a: 1, withinMs: 5000 }, 4)).toBe(false);
  });

  it("switching a within row on the last step to between keeps b inside the funnel", () => {
    expect(spanFrom({ step: OUT, a: 2, b: 3 }, 2, 2)).toEqual({ step: OUT, a: 1, b: 2 });
    expect(spanFrom({ step: OUT, a: 1, b: 4 }, 3, 4)).toEqual({ step: OUT, a: 3, b: 4 });
    expect(spanFrom({ step: OUT, a: 2, withinMs: 5000 }, 1, 3)).toEqual({
      step: OUT,
      a: 1,
      withinMs: 5000,
    });
  });

  it("an exclusion fits only when every step number it names exists", () => {
    expect(fitsSteps({ step: OUT, a: 1, b: 2 }, 2)).toBe(true);
    expect(fitsSteps({ step: OUT, a: 1, b: 3 }, 2)).toBe(false);
    expect(fitsSteps({ step: OUT, a: 2, b: 2 }, 3)).toBe(false);
    expect(fitsSteps({ step: OUT, a: 3, withinMs: 1000 }, 2)).toBe(false);
    expect(fitsSteps({ step: OUT, a: 2, withinMs: 1000 }, 2)).toBe(true);
  });

  it("seconds that round to 0 ms read as cleared, and the cap holds", () => {
    expect(toMs(0.0003)).toBeUndefined();
    expect(toMs("")).toBeUndefined();
    expect(toMs("abc")).toBeUndefined();
    expect(toMs(-1)).toBeUndefined();
    expect(toMs(1.5)).toBe(1500);
    expect(toMs(999999)).toBe(86400000);
  });

  it("removed units land on step b for a between row and step a for a within row", () => {
    const def = defOf(
      [A, B, C],
      [
        { step: OUT, a: 1, b: 3 },
        { step: OUT, a: 2, withinMs: 5000 },
        { step: p("/z"), a: 1, b: 3 },
      ],
    );
    expect(removedByStep(def, [4, 2, 1])).toEqual([null, 2, 5]);
    expect(removedByStep(def, [])).toEqual([null, null, null]);
  });
});
