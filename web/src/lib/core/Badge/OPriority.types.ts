/**
 * OPriority.types.ts — public types of OPriority.
 * No types should be defined inline in OPriority.vue.
 */

/** Priority level; P1 is the most urgent. */
export type PriorityLevel = 1 | 2 | 3;

export const PRIORITY_LEVELS = [1, 2, 3] as const satisfies readonly PriorityLevel[];

export interface PriorityProps {
  /** 1, 2 or 3; shown as P1–P3 by weight, not hue. */
  level: PriorityLevel;
}
