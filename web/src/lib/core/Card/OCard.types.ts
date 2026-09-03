/**
 * Visual chrome of the card surface.
 *
 * - `panel`    — the filled, borderless surface OCard has always drawn.
 * - `outlined` — base surface + one hairline border: the chrome every
 *   `card-container` panel elsewhere in the app uses, so a page built from
 *   OCards sits on the same grid as a page built from those.
 * - `glass`    — the tiled section pane of a dense detail page: translucent
 *   surface, hairline border, 4px corners, clipped content. Pair it with
 *   `dense` OCardSections so a column of panes reads as one divided page.
 */
export type OCardVariant = "panel" | "outlined" | "glass";

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
