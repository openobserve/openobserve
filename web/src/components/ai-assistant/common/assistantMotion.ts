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

/** The assistant's motion utilities (web/src/styles/tailwind.css); each falls back to a plain fade under reduced motion. */
export const ASSISTANT_MOTION = {
  panelIn: "assistant-panel-in",
  sparkle: "assistant-mark-sparkle",
  fadeUp: "assistant-fade-up",
  sweep: "assistant-sweep",
  wave: "assistant-wave",
  spin: "assistant-spin",
} as const;

/** Durations in milliseconds, matching the utilities, for code that waits on an animation to end. */
export const ASSISTANT_MOTION_MS = {
  panelIn: 220,
  sparkle: 400,
  fadeUp: 280,
  fadeUpDelay: 160,
  sweep: 1100,
  sweepDelay: 200,
  stagger: 40,
  reducedFade: 200,
} as const;

// Literal strings, because Tailwind only emits classes it can read in source.
const STAGGER_CLASSES = [
  "assistant-fade-up-0",
  "assistant-fade-up-1",
  "assistant-fade-up-2",
  "assistant-fade-up-3",
  "assistant-fade-up-4",
  "assistant-fade-up-5",
  "assistant-fade-up-6",
  "assistant-fade-up-7",
] as const;

export type AssistantMotion = (typeof ASSISTANT_MOTION)[keyof typeof ASSISTANT_MOTION];

export type AssistantStaggerClass = (typeof STAGGER_CLASSES)[number];

/** The fade-up delay class for the `index`th item of an opening sequence; items past the last step share it. */
export function staggerClass(index: number): AssistantStaggerClass {
  const step = Math.min(Math.max(Math.trunc(index), 0), STAGGER_CLASSES.length - 1);
  return STAGGER_CLASSES[Number.isFinite(step) ? step : 0];
}

/** Classes for one item of the opening sequence: fade up, staggered by its position. */
export function fadeUpClasses(
  index: number,
): [typeof ASSISTANT_MOTION.fadeUp, AssistantStaggerClass] {
  return [ASSISTANT_MOTION.fadeUp, staggerClass(index)];
}

/** True when the user asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** How long the opening sequence of `items` staggered items runs, so a caller can drop the classes after it. */
export function openingDurationMs(items: number, reduced = prefersReducedMotion()): number {
  if (reduced) return ASSISTANT_MOTION_MS.reducedFade;
  const lastStep = Math.min(Math.max(items - 1, 0), STAGGER_CLASSES.length - 1);
  const ms = ASSISTANT_MOTION_MS;
  const fadeUpEnd = ms.fadeUpDelay + lastStep * ms.stagger + ms.fadeUp;
  return Math.max(ms.panelIn, fadeUpEnd, ms.sweepDelay + ms.sweep);
}
