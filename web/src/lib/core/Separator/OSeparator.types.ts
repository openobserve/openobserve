export interface OSeparatorProps {
  /** Renders as a vertical line instead of horizontal */
  vertical?: boolean;
  /** Adds margin so the line does not span full width/height */
  inset?: boolean;
  /** Adds spacing above/below (horizontal) or left/right (vertical) */
  spaced?: boolean;
  /** Uses a heavier border color — maps to q-separator[color="grey-4"] */
  strong?: boolean;
}

export type OSeparatorEmits = Record<never, never>;
export type OSeparatorSlots = Record<never, never>;
