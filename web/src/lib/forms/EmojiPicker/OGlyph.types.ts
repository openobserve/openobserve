/**
 * OGlyph.types.ts — single source of truth for all OGlyph public types.
 * No types are declared inline in OGlyph.vue.
 */

/** A stored icon value: an emoji (`"🚀"`), `"o2:redis"`, `"icon:dashboard"` or `"mono:docker"`; callers treat it opaquely. */
export type IconToken = string;

/** Rendered footprint. `sm` suits a list row, `lg` a picker trigger. */
export type GlyphSize = "sm" | "md" | "lg";

export interface GlyphProps {
  /** The icon token to render. Renders nothing when empty or unresolvable. */
  token?: IconToken | null;
  size?: GlyphSize;
  /**
   * Alt text for the image-backed glyphs. Defaults to empty, which marks the
   * icon decorative — correct wherever a text label sits beside it.
   */
  alt?: string;
}
