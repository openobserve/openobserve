// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

/** Fill colour of a segment or marker; `default` is the brand accent, `muted`/`contrast` are non-semantic greys and `logs`/`metrics`/`traces` are the signal hues */
export type SegmentedBarVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "muted"
  | "contrast"
  | "logs"
  | "metrics"
  | "traces";

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
  logs: "bg-signal-logs",
  metrics: "bg-signal-metrics",
  traces: "bg-signal-traces",
};

/** Height of the track */
export type SegmentedBarSize = "sm" | "md";

export interface SegmentedBarSegment {
  id: string;
  /** Share of the track, 0 to 100 */
  pct: number;
  variant?: SegmentedBarVariant;
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
