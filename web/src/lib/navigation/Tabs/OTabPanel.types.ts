/**
 * OTabPanel.types.ts — single source of truth for OTabPanel public types.
 * OTabPanel renders the content area for one tab, shown when it is active.
 */

export interface OTabPanelProps {
  /** Must match the corresponding OTab name. Required. */
  name: string | number
}

export interface OTabPanelSlots {
  /** Panel content */
  default: () => unknown
}
