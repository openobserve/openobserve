/**
 * Button.types.ts — single source of truth for all OButton public types.
 * No types should be defined inline in Button.vue.
 */

import type { PrimitiveProps } from "reka-ui";

/** Visual style variant — design is baked in, no style override props */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "ghost-primary"
  | "ghost-muted"
  | "ghost-subtle"
  | "ghost-destructive"
  | "ghost-warning"
  | "ghost-neutral"
  | "outline-destructive"
  | "sidebar-toggle"
  // Dedicated variant for sidebar panel collapse/expand icon button
  | "panel-collapse"
  // Primary-colored tall-narrow vertical rectangle — for splitter collapse/expand buttons
  | "sidebar-button"
  | "destructive"
  // AI-themed gradient — purple→pink gradient background, white text (AI send/generate buttons)
  | "ai-gradient"
  // Use on dark gradient backgrounds — white background with primary text
  | "on-dark-primary"
  // Use on dark gradient backgrounds — transparent with white border/text
  | "on-dark-ghost"
  // Solid warning (yellow) background — use to draw attention to a required action
  | "warning"
  // Destination preview buttons — brand-colored CTAs inside alert destination preview cards
  | "preview-slack"
  | "preview-teams"
  | "preview-email"
  // Generic preview action button — for destination previews with no specific brand color
  | "preview-action"
  // Webinar banner dismiss — inline text-link style button for the top bar banner
  | "webinar-dismiss"
  // Pricing template chip — pill-shaped toggle chip for quick-setup template selection
  | "pricing-chip";

/** Size controls height, padding, font-size, and border-radius */
export type ButtonSize =
  | "xs"
  | "chip"
  | "sm"
  | "sm-action"
  | "md"
  | "lg"
  | "icon"
  | "icon-xs"
  | "icon-xs-circle"
  | "icon-xs-sq"
  | "icon-chip"
  | "icon-sm"
  | "icon-md"
  | "icon-lg"
  | "icon-circle"
  | "icon-circle-sm"
  // 30×30px square — matches toolbar icon button height (share/hamburger/auto-refresh)
  | "icon-toolbar"
  // 26px rounded-lg — compact modern icon button for panel header collapse/expand
  | "icon-panel"
  // Tall narrow vertical rectangle — 32×20px for splitter collapse/expand buttons
  | "sidebar-button"
  // 30px labeled button — matches toolbar icon height for labeled outline toolbar buttons
  | "sm-toolbar"
  // Chip with fixed 12px font — for dashboard query builder axis field chips
  | "chip-12";

export interface ButtonProps extends PrimitiveProps {
  /** Visual style variant */
  variant?: ButtonVariant;
  /** Component size */
  size?: ButtonSize;
  /** Disables the button and all interaction */
  disabled?: boolean;
  /** Shows loading state and disables interaction */
  loading?: boolean;
  /** Applies active/selected state styling (overrides variant to primary appearance) */
  active?: boolean;
  /** Native button type attribute — only meaningful when as="button" */
  type?: "button" | "submit" | "reset";
  /** Makes the button a block-level element ( full width, flex instead of inline-flex ) */
  block?: boolean;
  /** data-test attribute for E2E testing — declared as a prop so it reliably renders on the
   *  underlying DOM element even when OButton is used as a reka-ui as-child trigger */
  dataTest?: string;
}

export interface ButtonEmits {
  (e: "click", event: MouseEvent): void;
}

export interface ButtonSlots {
  /** Main label / content */
  default?: () => unknown;
  /** Icon placed before the label */
  "icon-left"?: () => unknown;
  /** Icon placed after the label */
  "icon-right"?: () => unknown;
}
