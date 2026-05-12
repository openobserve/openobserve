/**
 * ORouteTab.types.ts — types for ORouteTab
 * ORouteTab wraps OTab with Vue Router navigation.
 */

import type { RouteLocationRaw } from 'vue-router'

export interface ORouteTabProps {
  /** Unique identifier — must match v-model value on OTabs */
  name: string | number
  /** Display text label */
  label?: string
  /** Material icon name */
  icon?: string
  /** Route to navigate to when clicked */
  to?: RouteLocationRaw
  /** Prevents interaction */
  disable?: boolean
}

export interface ORouteTabSlots {
  /** Custom tab content (badge, icons, etc.) */
  default?: () => unknown
}
