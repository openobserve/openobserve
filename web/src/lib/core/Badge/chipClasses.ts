// Copyright 2026 OpenObserve Inc.

import type { ChipTone } from "./OBadge.types";

/** Fill and text per tone, with no edge: a chip reads by its soft fill (C2). Only `outline` draws one. */
export const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  neutral: "border-transparent bg-badge-default-soft-bg text-badge-default-ol-text",
  outline: "border-border-default bg-transparent text-badge-default-ol-text",
  accent: "border-transparent bg-badge-primary-soft-bg text-badge-primary-soft-text",
  ok: "border-transparent bg-badge-success-soft-bg text-badge-success-soft-text",
  warn: "border-transparent bg-badge-warning-soft-bg text-badge-warning-soft-text",
  err: "border-transparent bg-badge-error-soft-bg text-badge-error-soft-text",
  crit: "border-transparent bg-badge-purple-soft-bg text-badge-purple-soft-text",
  info: "border-transparent bg-badge-blue-soft-bg text-badge-blue-soft-text",
};
