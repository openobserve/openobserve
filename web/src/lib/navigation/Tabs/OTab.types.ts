/**
 * OTab.types.ts — single source of truth for OTab public types.
 * OTab renders a single clickable tab trigger inside OTabs.
 */

import type { I18nText } from "@/types/i18n";

export interface OTabProps {
  /** Unique identifier — must match the corresponding OTabPanel name */
  name: string | number;
  /** Display text label */
  label?: I18nText;
  /** Material icon name shown before the label */
  icon?: string;
  /** Prevents interaction with this tab */
  disable?: boolean;
  /**
   * Opt this single tab out of drag-to-reorder even while OTabs is reorderable
   * (e.g. its label is being renamed inline). The grip stays visible but the tab
   * is no longer draggable and shows a text cursor instead of grab.
   */
  disableDrag?: boolean;
  /** Tooltip shown on hover — especially useful when disable is true to explain why */
  tooltip?: I18nText;
}

export interface OTabSlots {
  /**
   * Custom tab trigger content (replaces default icon+label layout).
   * Used for badges, close icons, tooltips, and other rich content.
   * When provided, the `label` and `icon` props are ignored.
   */
  default?: () => unknown;
  /** Custom icon area — overrides the `icon` prop */
  icon?: () => unknown;
}
