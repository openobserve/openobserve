/**
 * OTabs.types.ts — single source of truth for OTabs public types.
 * OTabs is the tab-bar container that owns the active-tab state (v-model).
 */

/** Alignment of tabs within the tab bar */
export type TabsAlign = "left" | "center" | "right" | "justify";

/** Orientation of the tab bar */
export type TabsOrientation = "horizontal" | "vertical";

export interface OTabsProps {
  /** Currently active tab name — required, drives v-model */
  modelValue: string | number;
  /** Layout direction of the tab bar. Default: 'horizontal' */
  orientation?: TabsOrientation;
  /** Alignment of tabs within the tab bar. Default: 'left' */
  align?: TabsAlign;
  /** Compact height mode (~32px instead of ~40px) */
  dense?: boolean;
  /** Adds a bottom border matching the design-system border color token. Default: false */
  bordered?: boolean;
  /**
   * Enables drag-to-reorder. OTabs only reports the intended move via the
   * `reorder` event (by tab `name`); the parent owns the tab list/order and is
   * responsible for applying it. Default: false
   */
  reorderable?: boolean;
}

export interface OTabsEmits {
  (e: "update:modelValue", value: string | number): void;
  /** Fired after the active tab changes (same value as update:modelValue) */
  (e: "change", value: string | number): void;
  /**
   * Fired when a tab is dropped onto another (reorderable mode). `from` is the
   * dragged tab's name, `to` is the drop-target tab's name, and `before`
   * indicates the drop side (true = insert before the target, false = after) as
   * determined by the pointer position. The parent moves `from` accordingly.
   */
  (e: "reorder", payload: { from: string | number; to: string | number; before: boolean }): void;
}

export interface OTabsSlots {
  /** OTab children */
  default: () => unknown;
}

/** Shape of the provide() payload shared with child OTab components */
export interface TabsContext {
  /** Currently active tab name */
  modelValue: string | number;
  /** Called by OTab when it is clicked */
  onTabClick: (name: string | number) => void;
  /** Whether the tab bar is in vertical orientation */
  isVertical: boolean;
  /** Whether the tab bar is in dense mode */
  dense: boolean;
  /** Whether tabs can be dragged to reorder (sets draggable on each tab) */
  reorderable: boolean;
  /** Name of the tab currently being dragged (null when not dragging) */
  draggingName: string | number | null;
  /** Name of the tab the pointer is hovering as a drop target (null = none) */
  dropTargetName: string | number | null;
  /** Drop side for the current drop target: true = before, false = after */
  dropBefore: boolean;
}

/** Symbol key used for provide / inject */
export const TABS_CONTEXT_KEY = Symbol("OTabsContext");
