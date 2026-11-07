// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

/** `date` is `YYYY-MM-DD`; `time` is 24h `HH:mm:ss`; `time12` shows `hh:mm:ss AM` but models 24h. */
export type SegmentedFieldPattern = "date" | "time" | "time12";

export type SegmentKind =
  "year" | "month" | "day" | "hour" | "minute" | "second" | "period" | "offset";

/** `out-of-range` is a whole date outside `min`/`max`; `invalid` is a date that does not exist. */
export type SegmentedFieldStatus = "empty" | "incomplete" | "invalid" | "out-of-range" | "valid";

export type SegmentedFieldEdge = "next" | "prev";

/** A segment changed by a step key, for a live-region announcement. */
export interface SegmentedFieldStep {
  kind: SegmentKind;
  label: string;
  value: string;
}

export interface SegmentedFieldProps {
  /** Canonical `YYYY-MM-DD` or 24h `HH:mm:ss`; empty while unset, incomplete or not a real date; kept when out of range. */
  modelValue?: string;
  pattern: SegmentedFieldPattern;
  /** Offsets offered for a repeated wall time, e.g. `["UTC-04:00", "UTC-05:00"]`; two or more add an offset segment. */
  offsets?: string[];
  /** The chosen entry of `offsets`. */
  offset?: string;
  /** Marks the field invalid and shows the error icon. */
  error?: boolean;
  /** Message rendered under the field; omit when the caller renders it elsewhere. */
  errorMessage?: I18nText;
  /** Keeps the field invalid for assistive tech but drops its icon, for a caller that marks the error on a shared border. */
  hideErrorIcon?: boolean;
  /** Id of an element elsewhere that holds the error text. */
  errorId?: string;
  ariaLabel?: I18nText;
  /** Ids of elements describing the expected format. */
  describedBy?: string;
  /** Names announced for each segment, e.g. `{ second: "Seconds" }`. */
  segmentLabels?: Partial<Record<SegmentKind, I18nText>>;
  /** The AM and PM texts for `time12`. */
  dayPeriods?: [string, string];
  /** Earliest whole date, `YYYY-MM-DD` (date pattern only). */
  min?: string;
  /** Latest whole date, `YYYY-MM-DD` (date pattern only). */
  max?: string;
  disabled?: boolean;
  /** Tints the field to show its value was just filled in by the caller (a paste). */
  highlighted?: boolean;
}

export interface SegmentedFieldEmits {
  (e: "update:modelValue", value: string): void;
  (e: "update:offset", value: string): void;
  (e: "update:status", value: SegmentedFieldStatus): void;
  /** The last segment was filled by typing; focus may move on. */
  (e: "complete"): void;
  (e: "submit"): void;
  /** Raw clipboard text from ⌘V / Ctrl+V; it is never inserted. */
  (e: "paste-text", value: string): void;
  (e: "step", value: SegmentedFieldStep): void;
  /** An arrow key left the first or last segment. */
  (e: "edge", value: SegmentedFieldEdge): void;
  (e: "blur", event: FocusEvent): void;
  (e: "focus", event: FocusEvent): void;
}

/** Methods the parent reaches through a template ref. */
export interface SegmentedFieldExposed {
  focusSegment: (which: "first" | "last" | "invalid") => void;
}
