/**
 * OTabPanel.types.ts — single source of truth for OTabPanel public types.
 * OTabPanel renders the content area for one tab, shown when it is active.
 */

/** Inner padding of the panel content area */
export type TabPanelPadding = "none" | "sm" | "md";

/** Display layout of the panel's root element */
export type TabPanelLayout = "block" | "flex-col" | "flex-row";

export interface OTabPanelProps {
  /** Must match the corresponding OTab name. Required. */
  name: string | number;
  /** Inner padding of the panel content area. Default: 'none' */
  padding?: TabPanelPadding;
  /** Display layout of the panel's root element. Default: 'block' */
  layout?: TabPanelLayout;
  /** Makes the panel root element fill 100% of parent height. Default: false */
  stretch?: boolean;
  /**
   * Extra classes for the panel root. Use this rather than a bare `class=` on
   * `<OTabPanel>`: the component has multiple template roots, so Vue cannot
   * auto-inherit a `class` attribute onto the rendered element and drops it
   * silently. A prop is always received, so it actually lands.
   */
  contentClass?: string;
}

export interface OTabPanelSlots {
  /** Panel content */
  default: () => unknown;
}
