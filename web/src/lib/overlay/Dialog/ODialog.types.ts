/**
 * ODialog.types.ts — public types for ODialog.
 */

export type DialogSize = "xs" | "sm" | "md" | "lg" | "xl" | "full";

export interface DialogProps {
  /** Controlled open state — use with v-model:open */
  open?: boolean;

  /**
   * Prevents the dialog from closing when the user clicks the overlay
   * or presses Escape. Equivalent to Quasar `persistent`.
   * @default false
   */
  persistent?: boolean;

  /**
   * Controls dialog panel width.
   * xs=320px | sm=480px | md=640px (default) | lg=800px | xl=1024px | full=screen
   * @default "md"
   */
  size?: DialogSize;

  /**
   * Convenience prop: plain-text title rendered inside the header section.
   * Ignored when the `header` slot is provided.
   */
  title?: string;

  /**
   * Whether to render a built-in × close button in the top-right corner.
   * Only applies when `persistent` is false.
   * @default true
   */
  showClose?: boolean;

  /**
   * Dialog panel width as a percentage of the viewport width (1–100).
   * Translates directly to a `vw` unit, e.g. `width={60}` → `60vw`.
   * When provided, overrides the `size` preset width entirely.
   */
  width?: number;
}

export interface DialogEmits {
  /** Fires whenever the open state changes — use with v-model:open */
  (e: "update:open", value: boolean): void;
}

export interface DialogSlots {
  /**
   * The element that opens the dialog.
   * Rendered as-child into Reka's DialogTrigger.
   * Omit when controlling open state exclusively via v-model:open.
   */
  trigger?: () => unknown;

  /**
   * Header section — title row at the top of the dialog panel.
   * When provided, the `title` prop is ignored.
   * When omitted, no header section is rendered (useful for custom layouts).
   */
  header?: () => unknown;

  /**
   * Body / content section — the main scrollable area.
   * Always rendered.
   */
  default?: () => unknown;

  /**
   * Footer section — action buttons row at the bottom.
   * When omitted, no footer section is rendered.
   */
  footer?: () => unknown;
}
