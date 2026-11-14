/**
 * OTab.types.ts — single source of truth for OTab public types.
 * OTab renders a single clickable tab trigger inside OTabs.
 */

import type { I18nText } from "@/types/i18n";

import type { RouteLocationRaw } from "vue-router";

/** Tone of the count chip; error only for a count that is itself the exception (guideline C3). */
export type TabCountTone = "default" | "error";

export interface OTabProps {
  /** Unique identifier — must match the corresponding OTabPanel name */
  name: string | number;
  /** Display text label */
  label?: I18nText;
  /** Material icon name shown before the label */
  icon?: string;
  /**
   * Count after the label: tabular, capped at "999+", and always as wide as "999+".
   * `null` reserves the chip's width while the count loads.
   */
  count?: number | null;
  /** Count chip tone. Default: 'default' */
  countTone?: TabCountTone;
  /** Shows a lock glyph after the label (a licence- or role-locked page). */
  locked?: boolean;
  /** Screen-reader text for the lock glyph; falls back to `tooltip`. */
  lockedLabel?: I18nText;
  /** Shows an accent dot: the tab has unsaved changes. */
  dirty?: boolean;
  /** Prevents interaction with this tab */
  disabled?: boolean;
  /**
   * Opt this single tab out of drag-to-reorder even while OTabs is reorderable
   * (e.g. its label is being renamed inline). The grip stays visible but the tab
   * is no longer draggable and shows a text cursor instead of grab.
   */
  disableDrag?: boolean;
  /** Tooltip shown on hover — especially useful when disabled is true to explain why */
  tooltip?: I18nText;
  /** Route tab: navigates here on click and selects itself while the route name equals `name`. */
  to?: RouteLocationRaw;
}

export interface OTabSlots {
  /**
   * Custom tab trigger content (replaces default icon+label layout).
   * Used for close icons, tooltips, and other rich content.
   * When provided, the `label` and `icon` props are ignored.
   */
  default?: () => unknown;
  /** Custom icon area — overrides the `icon` prop */
  icon?: () => unknown;
  /** Controls beside the trigger (e.g. a toggle button), kept out of it so the tab never nests buttons. */
  trailing?: () => unknown;
}
