/**
 * ODialog.types.ts — public types for ODialog.
 */

import type { ButtonVariant } from "@/lib/core/Button/OButton.types";

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
}

export interface DialogEmits {
  /** Fires whenever the open state changes — use with v-model:open */
  (e: "update:open", value: boolean): void;
  /** Fires when the primary inbuilt button is clicked. */
  (e: "click:primary"): void;
  /** Fires when the secondary inbuilt button is clicked. */
  (e: "click:secondary"): void;
  /** Fires when the neutral inbuilt button is clicked. */
  (e: "click:neutral"): void;
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
