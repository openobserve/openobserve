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

import { toRaw } from "vue";
import {
  MAX_PARAM_LENGTH,
  encodeDef,
  exclusionProblem,
  funnelParam,
  stepRefParam,
} from "@/utils/rum/productAnalyticsModel";
import type { ExclusionStep, FunnelDef, StepRef } from "@/utils/rum/productAnalyticsQueries";

export const MAX_STEP_MS = 86400000;

export interface FunnelEdit {
  def: FunnelDef;
  dropped: ExclusionStep[];
}

const sameStep = (a: StepRef, b: StepRef): boolean =>
  JSON.stringify(stepRefParam(a)) === JSON.stringify(stepRefParam(b));

const withX = (def: FunnelDef, steps: StepRef[], kept: ExclusionStep[]): FunnelDef => ({
  ...def,
  steps,
  ...(def.x ? { x: kept } : {}),
});

/** Where each step of `next` stood in `prev`, or null when `next` is not a reordering of `prev`. */
export function stepOrder(prev: StepRef[], next: StepRef[]): number[] | null {
  const used = new Set<number>();
  const pick = (match: (p: StepRef) => boolean) =>
    prev.findIndex((p, k) => !used.has(k) && match(p));
  const order = next.map((s) => {
    let i = pick((p) => toRaw(p) === toRaw(s));
    if (i < 0) i = pick((p) => sameStep(p, s));
    if (i >= 0) used.add(i);
    return i;
  });
  return order.length === prev.length && order.every((i) => i >= 0) ? order : null;
}

// Each exclusion follows its steps; one whose span inverts or now holds its own target cannot stay.
export function reorderSteps(def: FunnelDef, order: number[]): FunnelEdit {
  const steps = order.map((i) => def.steps[i]);
  const pos = (k: number) => order.indexOf(k - 1) + 1;
  const kept: ExclusionStep[] = [];
  const dropped: ExclusionStep[] = [];
  for (const x of def.x ?? []) {
    const moved: ExclusionStep =
      x.b !== undefined ? { ...x, a: pos(x.a), b: pos(x.b) } : { ...x, a: pos(x.a) };
    const inverted = moved.b !== undefined && moved.a >= moved.b;
    if (inverted || exclusionProblem(steps, moved)) dropped.push(x);
    else kept.push(moved);
  }
  return { def: withX(def, steps, kept), dropped };
}

export function moveStep(def: FunnelDef, i: number, by: number): FunnelEdit | null {
  const j = i + by;
  if (i < 0 || j < 0 || i >= def.steps.length || j >= def.steps.length) return null;
  const order = def.steps.map((_, k) => k);
  [order[i], order[j]] = [order[j], order[i]];
  return reorderSteps(def, order);
}

// An exclusion must never point at a missing step, so one that used the removed step goes with it.
export function removeStep(def: FunnelDef, i: number): FunnelEdit {
  const n = i + 1;
  const shift = (k: number) => (k > n ? k - 1 : k);
  const kept: ExclusionStep[] = [];
  const dropped: ExclusionStep[] = [];
  for (const x of def.x ?? []) {
    if (x.a === n || x.b === n) dropped.push(x);
    else
      kept.push(
        x.b !== undefined ? { ...x, a: shift(x.a), b: shift(x.b) } : { ...x, a: shift(x.a) },
      );
  }
  return {
    def: withX(
      def,
      def.steps.filter((_, j) => j !== i),
      kept,
    ),
    dropped,
  };
}

// A typed value that rounds to 0 ms is no time at all, so it reads as cleared.
export function toMs(v: string | number): number | undefined {
  const ms = v === "" ? NaN : Math.round(Number(v) * 1000);
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_STEP_MS) : undefined;
}

// A between row needs a later step, so its start stays before the last step and its end inside the funnel.
export function spanFrom(x: ExclusionStep, a: number, steps: number): ExclusionStep {
  if (x.b === undefined) return { step: x.step, a, withinMs: x.withinMs };
  const start = Math.max(1, Math.min(a, steps - 1));
  return { step: x.step, a: start, b: Math.min(Math.max(x.b, start + 1), steps) };
}

/** Whether an exclusion's step numbers all name steps of a funnel this long, as parseExclusion requires. */
export function fitsSteps(x: ExclusionStep, steps: number): boolean {
  if (x.a < 1 || x.a > steps) return false;
  return x.b === undefined || (x.a < x.b && x.b <= steps);
}

/** A new exclusion spans the whole funnel, step 1 to the last step. */
export function newExclusion(def: FunnelDef, step: StepRef): ExclusionStep {
  return { step, a: 1, b: Math.max(2, def.steps.length) };
}

export function isWholeFunnel(x: ExclusionStep, steps: number): boolean {
  return x.b !== undefined && x.a === 1 && x.b === steps;
}

// The URL keeps the funnel, so a definition past what a link can carry is refused.
export function fitsLink(def: FunnelDef): boolean {
  return encodeDef(funnelParam(def)).length <= MAX_PARAM_LENGTH;
}

/** Units each step lost to exclusions: a between row removes at step b, a within row at step a. */
export function removedByStep(def: FunnelDef, removed: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = def.steps.map(() => null);
  (def.x ?? []).forEach((x, j) => {
    const n = removed[j];
    if (n === null || n === undefined) return;
    const i = (x.b ?? x.a) - 1;
    out[i] = (out[i] ?? 0) + n;
  });
  return out;
}
