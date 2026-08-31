/**
 * OGlyph.types.ts — single source of truth for all OGlyph public types.
 * No types are declared inline in OGlyph.vue.
 */

/**
 * A stored icon value. Either a Unicode emoji (`"🚀"`) or a registry glyph
 * reference (`"o2:redis"`). Callers persist and pass this opaquely; only OGlyph
 * and the registry need to know the difference.
 */
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
