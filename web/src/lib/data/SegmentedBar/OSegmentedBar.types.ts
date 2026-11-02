// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

/** Fill colour of a segment or marker; `default` is the brand accent, `muted`/`contrast` are non-semantic greys and `blue`/`purple`/`teal` are categorical */
export type SegmentedBarVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "muted"
  | "contrast"
  | "blue"
  | "purple"
  | "teal";

/** Background token class per variant; legends reuse it so their dots match the bar */
export const SEGMENT_SWATCH: Record<SegmentedBarVariant, string> = {
  default: "bg-accent",
  success: "bg-status-positive",
  warning: "bg-status-warning-text",
  danger: "bg-status-negative",
  info: "bg-status-info-text",
  neutral: "bg-status-neutral-text",
  muted: "bg-border-strong",
  contrast: "bg-text-secondary",
  blue: "bg-segment-blue-1",
  purple: "bg-segment-purple-1",
  teal: "bg-segment-teal-1",
};

/** Ranked steps of each categorical variant, rank 1 first; every step keeps 3:1 against the card in both themes */
export const SEGMENT_RAMP: Record<"blue" | "purple" | "teal", readonly string[]> = {
  blue: [
    "bg-segment-blue-1",
    "bg-segment-blue-2",
    "bg-segment-blue-3",
    "bg-segment-blue-4",
    "bg-segment-blue-5",
  ],
  purple: [
    "bg-segment-purple-1",
    "bg-segment-purple-2",
    "bg-segment-purple-3",
    "bg-segment-purple-4",
    "bg-segment-purple-5",
  ],
  teal: [
    "bg-segment-teal-1",
    "bg-segment-teal-2",
    "bg-segment-teal-3",
    "bg-segment-teal-4",
    "bg-segment-teal-5",
  ],
};

/** Swatch class for a variant at a rank step; only categorical variants have steps, and steps past the last reuse it */
export function segmentFill(variant: SegmentedBarVariant | undefined, shade = 0): string {
  const key = variant ?? "default";
  if (key !== "blue" && key !== "purple" && key !== "teal") return SEGMENT_SWATCH[key];
  const ramp = SEGMENT_RAMP[key];
  return ramp[Math.min(Math.max(0, shade), ramp.length - 1)];
}

/** Height of the track */
export type SegmentedBarSize = "sm" | "md" | "lg";

export interface SegmentedBarSegment {
  id: string;
  /** Share of the track, 0 to 100 */
  pct: number;
  variant?: SegmentedBarVariant;
  /** Rank step of a categorical variant, 0 (rank 1) to 4; see SEGMENT_RAMP */
  shade?: number;
  /** Native tooltip naming the segment, since a segment has no visible text */
  title?: I18nText;
}

export interface SegmentedBarMarker {
  id: string;
  /** Position along the track, 0 to 100 */
  pct: number;
  variant?: SegmentedBarVariant;
}

export interface SegmentedBarProps {
  segments: SegmentedBarSegment[];
  /** Ticks drawn over the track, e.g. a capacity or limit line */
  markers?: SegmentedBarMarker[];
  /** Track height. Default: "sm" */
  size?: SegmentedBarSize;
  /** Separates segments with a small gap and keeps every non-empty one visible; the track is left unpainted, so pass a remainder segment */
  gapped?: boolean;
  /** Accessible name; without it the bar is hidden from assistive tech because a legend is expected beside it */
  label?: I18nText;
}
