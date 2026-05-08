// Copyright 2026 OpenObserve Inc.

import type { InjectionKey } from "vue";

export type RadioSize = "xs" | "sm" | "md";
export type RadioValue = string | number | boolean;

export const RADIO_VALUE_MAP_KEY: InjectionKey<Map<string, RadioValue>> =
  Symbol("RadioValueMap");

export interface RadioGroupProps {
  /** Currently selected value */
  modelValue?: RadioValue;
  /** Accessible name for the group — rendered as a visually-hidden legend */
  label?: string;
  /** Disables all radio buttons in the group */
  disabled?: boolean;
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
  /** q-radio compatibility alias for `value` */
  val?: RadioValue;
  /** Accessible label */
  label?: string;
  /** Control size */
  size?: RadioSize;
  /** q-radio compatibility for tighter spacing */
  dense?: boolean;
  /** q-radio compatibility prop; visual tokens are handled internally */
  color?: string;
  /** Prevents interaction */
  disabled?: boolean;
  /** HTML id — forwarded for label association */
  id?: string;
}

export interface RadioSlots {
  /** Custom label content */
  label?: () => unknown;
}
