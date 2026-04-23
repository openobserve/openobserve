/**
 * Anchor/self position descriptor — mirrors q-menu's two-word format.
 * First word: vertical edge, second word: horizontal alignment.
 * 'start'/'end' are RTL-aware aliases for 'left'/'right'.
 */
export type MenuPosition =
  | 'top left'
  | 'top middle'
  | 'top right'
  | 'top start'
  | 'top end'
  | 'bottom left'
  | 'bottom middle'
  | 'bottom right'
  | 'bottom start'
  | 'bottom end'
  | 'center left'
  | 'center middle'
  | 'center right'
  | 'center start'
  | 'center end'

export interface MenuProps {
  /** Whether the menu is open. Use with v-model. */
  modelValue?: boolean
  /**
   * Which edge/corner of the **trigger element** the menu attaches to.
   * @default 'bottom left'
   */
  anchor?: MenuPosition
  /**
   * Which edge/corner of the **menu panel** aligns to the anchor point.
   * @default 'top left'
   */
  self?: MenuPosition
  /**
   * Additional [x, y] pixel offset applied after anchor/self positioning.
   * @default [0, 4]
   */
  offset?: [number, number]
  /** Inline style applied to the floating panel (escape hatch for z-index, width, etc.). */
  contentStyle?: string | Record<string, string>
  /** When true, clicking outside does not close the menu. */
  persistent?: boolean
  /**
   * When true, the menu opens on mouseenter and closes on mouseleave.
   * Use for nested submenus anchored to a row item inside a parent menu.
   */
  submenu?: boolean
}

export interface MenuEmits {
  (e: 'update:modelValue', value: boolean): void
  /** Fired after the menu panel becomes visible. */
  (e: 'show'): void
  /** Fired after the menu panel is hidden. */
  (e: 'hide'): void
}
