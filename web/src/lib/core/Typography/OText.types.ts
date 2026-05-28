/**
 * OText — polymorphic typography component.
 *
 * Each variant maps to a fixed combination of font-size, font-weight,
 * color token, and default HTML element. Developers pick a variant by
 * semantic intent, not by remembering Tailwind class strings.
 *
 * Variant → default element mapping (override with `as` prop):
 *   page-title  → <span>   (use as="h1" for the single page-level title)
 *   section     → <h2>     (group labels like "Web Vitals", "Key Fields")
 *   panel-title → <h3>     (card/panel header labels)
 *   body        → <p>      (default readable text)
 *   body-strong → <strong> (emphasized inline text)
 *   label       → <span>   (form-adjacent / column sub-labels)
 *   meta        → <span>   (timestamps, counts, secondary metadata)
 *   mono        → <span>   (cron, IDs, stream names — non-linked)
 */

export type TextVariant =
  /** Page header title. 14px semibold. One per page. */
  | "page-title"
  /** Section group label. 12px semibold uppercase tracking-wide. Secondary color. */
  | "section"
  /** Panel or card title. 12px medium. Primary color. */
  | "panel-title"
  /** Default body paragraph. 14px normal. */
  | "body"
  /** Emphasized inline text. 14px semibold. */
  | "body-strong"
  /** Compact form-adjacent label. 12px semibold. */
  | "label"
  /** Metadata: timestamps, counts, hints. 12px normal secondary. */
  | "meta"
  /** Monospace: cron expressions, IDs, field names. 12px IBM Plex Mono. */
  | "mono";

export interface TextProps {
  /**
   * Visual and semantic variant.
   * @default "body"
   */
  variant?: TextVariant;

  /**
   * Override the rendered HTML element.
   * Each variant has a sensible default — see the mapping in OText.vue.
   * Common overrides:
   *   - `as="h1"` on `variant="page-title"` for the page's single heading
   *   - `as="span"` on `variant="body"` when an inline context is needed
   *   - `as="div"` on `variant="section"` for non-heading group labels
   */
  as?: string;

  /**
   * Truncate text with ellipsis on overflow.
   * Adds `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`.
   */
  truncate?: boolean;

  /**
   * Prevent line wrapping (white-space: nowrap).
   * Useful for table cells and labels that must stay on one line.
   */
  nowrap?: boolean;
}

export interface TextSlots {
  default(): unknown;
}
