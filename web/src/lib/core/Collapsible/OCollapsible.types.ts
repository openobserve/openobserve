export interface OCollapsibleProps {
  /** Trigger label text (used when no #trigger slot is provided) */
  label?: string;
  /**
   * Material icon name shown before the label.
   * Pass the icon name string e.g. `"settings"` or `"expand_more"`.
   */
  icon?: string;
  /** Secondary caption text below the label */
  caption?: string;
  /**
   * Initial open state (uncontrolled).
   * When `modelValue` is also provided, `modelValue` takes precedence.
   */
  defaultOpen?: boolean;
  /**
   * Controlled open state. Use with `v-model`.
   * When provided, the parent owns the open/close state.
   */
  modelValue?: boolean;
  /**
   * Accordion group name. All OCollapsible items with the same `group` string
   * will behave as an accordion ΓÇö only one can be open at a time.
   */
  group?: string;
}

export interface OCollapsibleEmits {
  (e: "update:modelValue", value: boolean): void;
  /** Fires just before the content becomes visible */
  (e: "open"): void;
  /** Fires after the content is fully visible */
  (e: "opened"): void;
  /** Fires just before the content is hidden */
  (e: "close"): void;
  /** Fires after the content is fully hidden */
  (e: "closed"): void;
}

export interface OCollapsibleSlots {
  /** Collapsible body content */
  default(): unknown;
  /**
   * Fully custom trigger row ΓÇö replaces the default label/icon/caption + chevron.
   * When this slot is provided the built-in chevron is hidden automatically.
   * Exposes `{ open: boolean }` so you can render a custom icon based on state.
   */
  trigger(props: { open: boolean }): unknown;
}
