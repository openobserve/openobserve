// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

/** Read for truthiness; the switch always emits a boolean. */
export type SwitchValue = boolean | string | number;

export interface SwitchProps {
  /** Current on/off state */
  modelValue?: SwitchValue;
  /** Accessible label rendered beside the switch */
  label?: I18nText;
  /** Secondary line under the label */
  description?: I18nText;
  /** `end` puts the label after the switch (forms); `start` before it (setting rows). */
  labelPosition?: "start" | "end";
  /** Prevents interaction */
  disabled?: boolean;
  /** Marks the field required — renders a `*` after the label (no manual ` *`). */
  required?: boolean;
  /** `"neutral"` draws Off in grey, for rows where a brand-coloured Off reads as On. */
  offTone?: "brand" | "neutral";
  /** Prints On / Off after the track. */
  stateText?: boolean;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
}

export interface SwitchEmits {
  (_e: "update:modelValue", _value: boolean): void;
  (_e: "change", _value: boolean): void;
}

export interface SwitchSlots {
  /** Custom label content — overrides the `label` prop */
  label?: () => unknown;
  /** Tooltip content — renders an info icon inline in the label when provided.
   *  The icon gets `data-test="${parentDataTest}-info"` automatically. */
  tooltip?: () => unknown;
}
