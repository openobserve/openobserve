/**
 * Named icon sizes.
 * - xs  → 12px
 * - sm  → 16px
 * - md  → 20px
 * - lg  → 24px
 * - xl  → 32px
 *
 * When omitted the icon inherits `font-size` from its parent context.
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
   * Icon size — named shorthand only.
   *
   * `'xs'` (12px) | `'sm'` (16px) | `'md'` (20px) | `'lg'` (24px) | `'xl'` (32px)
   *
   * When omitted the icon inherits `font-size` from its parent context
   * (Material Icons default is 24 px via the `material-icons` CSS class).
   */
  size?: IconSize;
}

/** Default slot — provide custom SVG or other icon markup when `name` is not set. */
export interface IconSlots {
  default?: () => unknown;
}
