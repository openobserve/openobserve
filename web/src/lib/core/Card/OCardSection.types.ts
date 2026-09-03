/**
 * OCardSection ΓÇö semantic section inside an OCard.
 *
 * `role` bundles the correct padding, flex-grow, flex-shrink, and layout for
 * the three standard zones. Pass `class` directly for anything outside these zones.
 */

/** Semantic role of this section within the card */
export type OCardSectionRole = "header" | "body" | "footer";

export interface OCardSectionProps {
  /**
   * Semantic zone role.
   * - `"header"` ΓÇö flex row, items-center, non-growing, header padding
   * - `"body"`   ΓÇö grows, body padding
   * - `"footer"` ΓÇö shrinks, footer padding
   * Omit for a plain unstyled section ΓÇö apply classes directly.
   */
  role?: OCardSectionRole;
  /**
   * Adds `overflow-y: auto` and forces the section to fill remaining space.
   * Only meaningful with `role="body"`.
   */
  scrollable?: boolean;
  /**
   * Tightens the zone padding to the detail-page rhythm: a header that hugs its
   * title and a body that starts directly under it, instead of both zones
   * carrying full padding. Use it on every section of a card so the pane reads
   * as one block — pairs with `OCard variant="glass"`.
   */
  dense?: boolean;
}

export type OCardSectionEmits = Record<never, never>;

export interface OCardSectionSlots {
  default(): unknown;
}
