/**
 * ODrawer.types.ts — public types for ODrawer.
 *
 * ODrawer is a slide-in panel anchored to the left or right edge of the
 * viewport. It shares the same visual surface tokens as ODialog but differs
 * in positioning and transition (slide instead of zoom/fade).
 */

import type { ButtonVariant } from "@/lib/core/Button/OButton.types";

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

  /**
   * When true, the backdrop overlay is hidden so the rest of the page remains
   * interactive and visually unobscured (mirrors Quasar q-dialog `seamless`).
   * @default false
   */
  seamless?: boolean;

  // ── Header subtitle ────────────────────────────────────────────────────

  /**
   * Optional subtitle rendered below the title in the header, left-aligned.
   * Ignored when the `header` slot is provided.
   */
  subTitle?: string;

  // ── Inbuilt footer buttons ──────────────────────────────────────────────

  /** Label for the primary action button (right side). Omit to hide. */
  primaryButtonLabel?: string;
  /** Label for the secondary action button (right of neutral, left of primary). Omit to hide. */
  secondaryButtonLabel?: string;
  /** Label for the neutral action button (left side). Omit to hide. */
  neutralButtonLabel?: string;

  /** OButton variant for the primary button. @default "primary" */
  primaryButtonVariant?: ButtonVariant;
  /** OButton variant for the secondary button. @default "secondary" */
  secondaryButtonVariant?: ButtonVariant;
  /** OButton variant for the neutral button. @default "ghost" */
  neutralButtonVariant?: ButtonVariant;

  /** Explicitly disables the primary button. Auto-disabled when any button is loading. */
  primaryButtonDisabled?: boolean;
  /** Explicitly disables the secondary button. Auto-disabled when any button is loading. */
  secondaryButtonDisabled?: boolean;
  /** Explicitly disables the neutral button. Auto-disabled when any button is loading. */
  neutralButtonDisabled?: boolean;

  /** Shows loading spinner on primary button (also disables all buttons). */
  primaryButtonLoading?: boolean;
  /** Shows loading spinner on secondary button (also disables all buttons). */
  secondaryButtonLoading?: boolean;
  /** Shows loading spinner on neutral button (also disables all buttons). */
  neutralButtonLoading?: boolean;

  /**
   * When true (default), the default slot content is only rendered while the
   * drawer is open and destroyed when it closes. Set to false for drawers that
   * must preserve component state between open/close cycles.
   * @default true
   */
  lazy?: boolean;
}

export interface DrawerEmits {
  /** Fires whenever the open state changes — use with v-model:open */
  (e: "update:open", value: boolean): void;
  /** Fires when the primary inbuilt button is clicked. */
  (e: "click:primary"): void;
  /** Fires when the secondary inbuilt button is clicked. */
  (e: "click:secondary"): void;
  /** Fires when the neutral inbuilt button is clicked. */
  (e: "click:neutral"): void;
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
   * When provided, the `title` prop is ignored and sub-slots are also ignored.
   */
  header?: () => unknown;

  /**
   * Optional left sub-slot in the header row.
   * Rendered between the title/subtitle block and `#header-right`.
   * Ignored when the `#header` full-override slot is provided.
   */
  "header-left"?: () => unknown;

  /**
   * Optional right sub-slot in the header row.
   * Rendered between `#header-left` (or the title block) and the close button.
   * Ignored when the `#header` full-override slot is provided.
   */
  "header-right"?: () => unknown;

  /**
   * Body / content — the main scrollable area.
   */
  default?: () => unknown;

  /**
   * Footer section — always visible above the bottom edge; never scrolls.
   */
  footer?: () => unknown;
}
