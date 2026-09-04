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
}

export type OCardSectionEmits = Record<never, never>;

export interface OCardSectionSlots {
  default(): unknown;
}
