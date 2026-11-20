/**
 * ODrawer.types.ts — public types for ODrawer, the full-height panel from the right edge.
 */

import type { I18nText } from "@/types/i18n";
import type { OverlayAction } from "@/lib/overlay/shared/overlayFooter.types";

export type { OverlayAction } from "@/lib/overlay/shared/overlayFooter.types";

/** `left` is only for the navigation drawer a rail becomes on small screens (guideline R1). */
export type DrawerSide = "right" | "left";

/** sm 480 · md 640 · lg 800 · xl 960 (guideline O3). */
export type DrawerSize = "sm" | "md" | "lg" | "xl";

export const DRAWER_SIZES = ["sm", "md", "lg", "xl"] as const satisfies readonly DrawerSize[];

/** A compact tab under the drawer header. */
export interface DrawerTab {
  value: string;
  label: I18nText;
  count?: number;
  dataTest?: string;
}

export interface DrawerProps {
  /** Controlled open state — use with v-model:open */
  open?: boolean;

  /** Unsaved edits: Escape, ✕ and an outside click ask "Discard changes?" in the footer (V5). A nested OForm reports its own. */
  dirty?: boolean;

  /** A forced flow that cannot be dismissed: no ✕, and Escape and outside clicks do nothing. */
  persistent?: boolean;

  /** @default "right" */
  side?: DrawerSide;

  /** @default "md" */
  size?: DrawerSize;

  /** Full-bleed body for editors, embedded dashboards and tables that inset themselves. */
  bleed?: boolean;

  /** Header title, 15 px semibold. Ignored when the `header` slot is provided. */
  title?: I18nText;

  titleDataTest?: string;

  /** The header ✕; turn it off only when the header slot draws its own close. @default true */
  showClose?: boolean;

  /** No scrim, so the page behind stays visible. */
  seamless?: boolean;

  /** Accessible name for a drawer that renders its own header (no `title`). */
  ariaLabel?: I18nText;

  /** One line of facts under the title. */
  subtitle?: I18nText;

  subtitleDataTest?: string;

  /** Compact tabs fixed under the header; bind the active one with v-model:tab. */
  tabs?: DrawerTab[];

  tab?: string;

  /** Makes the primary a submit button of this form, so the form's own submit runs it. */
  formId?: string;

  /** Footer primary, right-most (guideline O7). */
  primary?: OverlayAction;
  /** Footer Cancel, left of the primary. */
  secondary?: OverlayAction;
  /** An extra action at the left of the footer (Delete). */
  extra?: OverlayAction;

  /** Renders the body only while open. @default true */
  lazy?: boolean;

  /** Portals into this element and positions inside its bounds instead of the window. */
  portalTarget?: string | HTMLElement | null;

  /** Element (or CSS selector) the drawer starts from, so app chrome above it stays visible; re-measured on resize. */
  anchor?: string | HTMLElement | null;

  /** Which edge of `anchor` the drawer starts at. @default "top" */
  anchorEdge?: "top" | "bottom";

  /** Render the portal in place for a contained drawer surface. */
  inline?: boolean;

  /** When false, the page behind stays interactive and only ✕ or Escape outside a field closes it. @default true */
  modal?: boolean;

  returnFocusTo?: () => HTMLElement | null;
}

export interface DrawerEmits {
  (e: "update:open", value: boolean): void;
  (e: "update:tab", value: string): void;
  (e: "click:primary"): void;
  (e: "click:secondary"): void;
  (e: "click:extra"): void;
  /** The user chose Discard in the "Discard changes?" footer; the drawer then closes. */
  (e: "discard"): void;
  (e: "after-close"): void;
}

export interface DrawerSlots {
  /** The element that opens the drawer; omit when controlling it with v-model:open. */
  trigger?: () => unknown;
  /** Replaces the whole title block; `header-left` and `header-right` are then ignored. */
  header?: () => unknown;
  "header-left"?: () => unknown;
  "header-right"?: () => unknown;
  /** The body; the only part that scrolls (guideline O6). */
  default?: () => unknown;
  /** Replaces the built-in footer actions; always visible above the bottom edge. */
  footer?: () => unknown;
  "footer-left"?: () => unknown;
}
