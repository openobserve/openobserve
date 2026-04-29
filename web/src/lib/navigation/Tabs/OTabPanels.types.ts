/**
 * OTabPanels.types.ts — single source of truth for OTabPanels public types.
 * OTabPanels is the container that shows the correct panel for the active tab.
 */

/** Overflow/scroll behavior of the panels container */
export type TabPanelsScroll = 'none' | 'auto' | 'y'

export interface OTabPanelsProps {
  /** Currently active tab name — must be kept in sync with OTabs v-model */
  modelValue: string | number
  /** Enables a CSS slide transition between panels */
  animated?: boolean
  /** Keeps all panel DOM alive when switching (avoids remounting) */
  keepAlive?: boolean
  /** Adds `tw:flex-1` so panels fill remaining space in a flex parent. Default: false */
  grow?: boolean
  /** Overflow/scroll behavior of the panels container. Default: 'none' */
  scroll?: TabPanelsScroll
}

export interface OTabPanelsEmits {
  (e: 'update:modelValue', value: string | number): void
}

export interface OTabPanelsSlots {
  /** OTabPanel children */
  default: () => unknown
}

/** Shape of the provide() payload shared with child OTabPanel components */
export interface TabPanelsContext {
  modelValue: string | number
  keepAlive: boolean
  animated: boolean
}

/** Symbol key used for provide / inject between OTabPanels → OTabPanel */
export const TAB_PANELS_CONTEXT_KEY = Symbol('OTabPanelsContext')
