// Copyright 2026 OpenObserve Inc.
/**
 * O2 Component Library
 *
 * Headless-first components using a three-layer design token strategy.
 * All components are drop-in replacements for their Quasar equivalents.
 *
 * Usage:
 *   import { O2Input } from '@/lib'
 *
 * Three-layer token strategy:
 *   Layer 1 – Primitive  : $o2-* SCSS variables  (web/src/styles/_variables.scss)
 *   Layer 2 – Semantic   : --o2-* CSS custom props (same file, :root / .body--dark)
 *   Layer 3 – Component  : --o2-<component>-* CSS custom props (per component)
 */

export { O2Input } from './components/forms/o2-input'
export type { O2InputProps } from './components/forms/o2-input'
