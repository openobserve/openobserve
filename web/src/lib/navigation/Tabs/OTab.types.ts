/**
 * OTab.types.ts — single source of truth for OTab public types.
 * OTab renders a single clickable tab trigger inside OTabs.
 */

export interface OTabProps {
  /** Unique identifier — must match the corresponding OTabPanel name */
  name: string | number
  /** Display text label */
  label?: string
  /** Material icon name shown before the label */
  icon?: string
  /** Prevents interaction with this tab */
  disable?: boolean
}

export interface OTabSlots {
  /**
   * Custom tab trigger content (replaces default icon+label layout).
   * Used for badges, close icons, tooltips, and other rich content.
   * When provided, the `label` and `icon` props are ignored.
   */
  default?: () => unknown
  /** Custom icon area — overrides the `icon` prop */
  icon?: () => unknown
}
