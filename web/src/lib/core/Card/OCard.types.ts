/**
 * Visual chrome of the card surface.
 *
 * - `panel`    — the filled, borderless surface OCard has always drawn.
 * - `outlined` — base surface + one hairline border: the chrome every
 *   `card-container` panel elsewhere in the app uses, so a page built from
 *   OCards sits on the same grid as a page built from those.
 */
export type OCardVariant = "panel" | "outlined";

/** OCard — flat surface container. */
export interface OCardProps {
  /** Defaults to `panel`. Use `class` for layout and sizing. */
  variant?: OCardVariant;
}

export type OCardEmits = Record<never, never>;

export interface OCardSlots {
  /** Card content — compose OCardSection, OSeparator, OCardActions inside */
  default(): unknown;
}
