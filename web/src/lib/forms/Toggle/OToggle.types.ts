// Copyright 2026 OpenObserve Inc.

export type ToggleSize = "sm" | "md" | "lg";

export interface ToggleProps {
  /** Current on/off state */
  modelValue?: boolean;
  /** Accessible label rendered beside the switch */
  label?: string;
  /** Whether the label appears before (start) or after (end) the switch */
  labelPlacement?: "start" | "end";
  /** q-toggle compatibility alias; when true places label on the left */
  leftLabel?: boolean;
  /** Control size */
  size?: ToggleSize;
  /** q-toggle compatibility for tighter spacing */
  dense?: boolean;
  /** q-toggle compatibility prop; visual tokens are handled internally */
  color?: string;
  /** q-toggle compatibility prop; kept for migration parity */
  flat?: boolean;
  /** Icon shown for both states when state-specific icons are absent */
  icon?: string;
  /** Icon shown when checked */
  checkedIcon?: string;
  /** Icon shown when unchecked */
  uncheckedIcon?: string;
  /** Prevents interaction */
  disabled?: boolean;
  /** HTML id */
  id?: string;
  /** HTML name */
  name?: string;
}

export interface ToggleEmits {
  (_e: "update:modelValue", _value: boolean): void;
  (_e: "change", _value: boolean): void;
}

export interface ToggleSlots {
  /** Custom label content — overrides the `label` prop */
  label?: () => unknown;
}
