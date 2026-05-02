/**
 * ODrawer.types.ts — public types for ODrawer.
 *
 * ODrawer is a slide-in panel anchored to the left or right edge of the
 * viewport. It shares the same visual surface tokens as ODialog but differs
 * in positioning and transition (slide instead of zoom/fade).
 */

/** Which viewport edge the drawer slides in from. */
export type DrawerSide = "right" | "left";

/**
 * Panel width presets.
 * sm=360px | md=480px (default) | lg=640px | xl=800px | full=100vw
 */
export type DrawerSize = "sm" | "md" | "lg" | "xl" | "full";

export interface DrawerProps {
  /** Controlled open state — use with v-model:open */
  open?: boolean;

  /**
   * Edge the drawer slides in from.
   * @default "right"
   */
  side?: DrawerSide;

  /**
   * Prevents the drawer from closing when the user clicks the overlay
   * or presses Escape.
   * @default false
   */
  persistent?: boolean;

  /**
   * Panel width preset.
   * sm=360px | md=480px (default) | lg=640px | xl=800px | full=100vw
   * @default "md"
   */
  size?: DrawerSize;

  /**
   * Explicit panel width as a percentage of the viewport width (1–100).
   * When provided, overrides the `size` preset entirely.
   */
  width?: number;

  /**
   * Convenience prop: plain-text title rendered in the header.
   * Ignored when the `header` slot is provided.
   */
  title?: string;

  /**
   * Whether to render a built-in × close button in the header.
   * Only applies when `persistent` is false.
   * @default true
   */
  showClose?: boolean;
}

export interface DrawerEmits {
  /** Fires whenever the open state changes — use with v-model:open */
  (e: "update:open", value: boolean): void;
}

export interface DrawerSlots {
  /**
   * Element that opens the drawer.
   * Rendered as-child into Reka's DialogTrigger.
   * Omit when controlling open state via v-model:open.
   */
  trigger?: () => unknown;

  /**
   * Header section at the top of the drawer, above the scrollable body.
   * When provided, the `title` prop is ignored.
   */
  header?: () => unknown;

  /**
   * Body / content — the main scrollable area.
   */
  default?: () => unknown;

  /**
   * Footer section — always visible above the bottom edge; never scrolls.
   */
  footer?: () => unknown;
}
