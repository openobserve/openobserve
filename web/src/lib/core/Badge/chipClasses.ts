// Copyright 2026 OpenObserve Inc.

import type { ChipTone } from "./OBadge.types";

/** Edge, fill and text per tone; status tones are the soft triplet. */
export const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  neutral: "border-badge-default-ol-border/30 bg-badge-default-soft-bg text-badge-default-ol-text",
  outline: "border-border-default bg-transparent text-badge-default-ol-text",
  accent: "border-badge-primary-ol-border bg-badge-primary-soft-bg text-badge-primary-soft-text",
  ok: "border-badge-success-ol-border/30 bg-badge-success-soft-bg text-badge-success-soft-text",
  warn: "border-badge-warning-ol-border/30 bg-badge-warning-soft-bg text-badge-warning-soft-text",
  err: "border-badge-error-ol-border/30 bg-badge-error-soft-bg text-badge-error-soft-text",
  crit: "border-badge-purple-ol-border/30 bg-badge-purple-soft-bg text-badge-purple-soft-text",
  info: "border-badge-blue-ol-border/30 bg-badge-blue-soft-bg text-badge-blue-soft-text",
};
