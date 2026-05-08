// Copyright 2026 OpenObserve Inc.

import type { InjectionKey } from "vue";

export type RadioSize = "sm" | "md";

export const RADIO_VALUE_MAP_KEY: InjectionKey<
  Map<string, string | number | boolean>
> = Symbol("RadioValueMap");

export interface RadioGroupProps {
  /** Currently selected value */
  modelValue?: string | number | boolean;
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
  (_e: "update:modelValue", _value: string | number | boolean): void;
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
  value: string | number | boolean;
  /** Accessible label */
  label?: string;
  /** Control size */
  size?: RadioSize;
  /** Prevents interaction */
  disabled?: boolean;
  /** HTML id — forwarded for label association */
  id?: string;
}

export interface RadioSlots {
  /** Custom label content */
  label?: () => unknown;
}
