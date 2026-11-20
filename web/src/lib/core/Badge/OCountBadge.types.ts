/**
 * OCountBadge.types.ts — public types of OCountBadge.
 * No types should be defined inline in OCountBadge.vue.
 */

/** err is for firing counts only; everything else is neutral or accent. */
export type CountBadgeTone = "err" | "neutral" | "accent";

export const COUNT_BADGE_TONES = [
  "err",
  "neutral",
  "accent",
] as const satisfies readonly CountBadgeTone[];

export interface CountBadgeProps {
  /** The number shown. */
  count: number;
  /** Default `"neutral"`. */
  tone?: CountBadgeTone;
  /** Counts above this read "<max>+". Default 99. */
  max?: number;
}
