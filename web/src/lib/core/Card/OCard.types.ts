/** OCard ΓÇö flat surface container. No variant props ΓÇö always flat. */
export interface OCardProps {
  // No props. Use `class` for layout and sizing.
}

export type OCardEmits = Record<never, never>;

export interface OCardSlots {
  /** Card content ΓÇö compose OCardSection, OSeparator, OCardActions inside */
  default(): unknown;
}
