/**
 * Named icon sizes.
 * - xs  → 12px
 * - sm  → 16px
 * - md  → 20px
 * - lg  → 24px
 * - xl  → 32px
 *
 * Raw CSS length strings are also accepted (e.g. '14px', '1.5rem', '0.875em').
 */
export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface IconProps {
  /**
   * Material Icons ligature name (e.g. `'search'`, `'delete'`, `'info'`).
   *
   * Prefix with `img:` to render an `<img>` element instead of an icon font
   * glyph (e.g. `'img:/path/to/icon.svg'`).
   *
   * Omit (or leave `undefined`) to use the default slot for custom SVG content.
   */
  name?: string;

  /**
   * Icon size — named shorthand or any CSS length value.
   *
   * Named: `'xs'` (12px) | `'sm'` (16px) | `'md'` (20px) | `'lg'` (24px) | `'xl'` (32px)
   *
   * Raw: `'14px'` | `'1.5rem'` | `'0.875em'` | …
   *
   * When omitted the icon inherits `font-size` from its parent context
   * (Material Icons default is 24 px via the `material-icons` CSS class).
   */
  size?: IconSize | (string & {});
}

/** Default slot — provide custom SVG or other icon markup when `name` is not set. */
export interface IconSlots {
  default?: () => unknown;
}
