/**
 * Separator.types.ts — single source of truth for all OSeparator public types.
 * No types should be defined inline in Separator.vue.
 *
 * Maps 1-to-1 with props that are actually used across the codebase — see the
 * Quasar migration analysis for the full usage breakdown.
 */

export interface SeparatorProps {
  /**
   * Renders the separator as a vertical line (width-based) instead of
   * a horizontal line (height-based).
   * Maps to: q-separator[vertical]
   * Used in: 27 instances across 134 files
   */
  vertical?: boolean

  /**
   * Adds horizontal margin so the line doesn't span full width/height.
   * Maps to: q-separator[inset]
   */
  inset?: boolean

  /**
   * Adds vertical margin above and below the line.
   * Maps to: q-separator[spaced]
   */
  spaced?: boolean

  /**
   * Optional semantic color override for the divider line.
   * Accepts a CSS variable name (e.g. "primary-300") that maps to
   * a --color-* token, or "strong" / "default" shorthand aliases.
   * Maps to: q-separator[color="..."]
   * Only 2 usages found in codebase — kept minimal on purpose.
   */
  color?: 'default' | 'strong' | string
}

// OSeparator emits nothing — it is a purely presentational element.
// Defined here for document completeness.
export type SeparatorEmits = Record<never, never>

// No slots — all slot content must go inside surrounding layout, not dividers.
export type SeparatorSlots = Record<never, never>
