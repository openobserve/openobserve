// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

import type { InjectionKey } from "vue";

export type RadioSize = "xs" | "sm" | "md";
export type RadioVariant = "default" | "card";
export type RadioValue = string | number | boolean;

export const RADIO_VALUE_MAP_KEY: InjectionKey<Map<string, RadioValue>> = Symbol("RadioValueMap");

export interface RadioGroupProps {
  /** Currently selected value */
  modelValue?: RadioValue;
  /** Accessible name for the group — rendered as a visually-hidden legend */
  label?: I18nText;
  /** Disables all radio buttons in the group */
  disabled?: boolean;
  /** Marks the field required — renders a `*` after the label (no manual ` *`). */
  required?: boolean;
  /** Layout direction of child radios */
  orientation?: "horizontal" | "vertical";
  /** HTML name attribute forwarded to all radios */
  name?: string;
}

export interface RadioGroupEmits {
  (_e: "update:modelValue", _value: RadioValue): void;
}

export interface RadioGroupSlots {
  default?: () => unknown;
}

// ── Individual radio ───────────────────────────────────────────────────────
// ORadio MUST be used inside ORadioGroup (which provides RadioGroupRoot context).

export interface RadioProps {
  /**
   * The value this radio represents.
   * Compared against ORadioGroup's modelValue to determine checked state.
   */
  value?: RadioValue;
  /** Compatibility alias for `value` */
  val?: RadioValue;
  /** Accessible label */
  label?: I18nText;
  /** Control size */
  size?: RadioSize;
  /** Prevents interaction */
  disabled?: boolean;
  /** Visual treatment for the label/control surface. */
  variant?: RadioVariant;
  /** HTML id — forwarded for label association */
  id?: string;
}

export interface RadioSlots {
  /** Custom label content */
  label?: () => unknown;
}
