// Copyright 2026 OpenObserve Inc.

/**
 * OInlineEdit.types.ts — single source of truth for OInlineEdit's public types.
 * No types are defined inline in OInlineEdit.vue.
 */

/**
 * Text scale of the edited value. The control is a TITLE affordance, so the
 * sizes map to the title end of the type scale — pick the one that matches the
 * heading it replaces (`md` matches OPageHeader's <h1>).
 */
export type InlineEditSize = "sm" | "md" | "lg";

/**
 * Which line of the header this value belongs to.
 *
 * - `"title"` (default) — heading weight and colour, sized by `size`.
 * - `"meta"` — the description/subtitle line: small, regular weight, secondary
 *   colour. `size` is ignored; the meta line has one size.
 */
export type InlineEditTone = "title" | "meta";

export interface InlineEditProps {
  /** Current value. Emitted back live while the user types. */
  modelValue?: string;
  /** Shown (muted) in display mode when the value is empty, and as the input's placeholder. */
  placeholder?: string;
  /** Accessible name for both the display trigger and the input. */
  ariaLabel?: string;
  /** Tooltip/title on the display trigger — e.g. "Click to rename". */
  editHint?: string;
  size?: InlineEditSize;
  /** Heading line (default) or the meta/description line. */
  tone?: InlineEditTone;
  maxlength?: number;
  disabled?: boolean;
  /** Renders the value as plain text with no edit affordance at all. */
  readonly?: boolean;
  /** Invalid state — red border while editing, red value in display mode. */
  error?: boolean;
  /** Message rendered below the control (absolutely, so the header never reflows). */
  errorMessage?: string;
}

export interface InlineEditEmits {
  /** Live on every keystroke — every emission is user-originated. */
  (_e: "update:modelValue", _value: string): void;
  /** User finished editing (Enter or blur). Carries the trimmed final value. */
  (_e: "commit", _value: string): void;
  /**
   * User pressed Escape. Carries the RESTORED (pre-edit) value, already emitted
   * back through update:modelValue — so a consumer can run the same
   * "what is the value now?" handler it uses for `commit`.
   */
  (_e: "cancel", _value: string): void;
  /** Entered edit mode. */
  (_e: "edit-start"): void;
}

export interface InlineEditSlots {
  /**
   * Trailing content rendered after the value in DISPLAY mode only — e.g. an
   * "Auto" badge marking a system-generated name. Hidden while editing so it
   * never competes with the input.
   */
  trail?: () => unknown;
}
