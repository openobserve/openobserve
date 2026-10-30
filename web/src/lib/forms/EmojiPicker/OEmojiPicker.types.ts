/**
 * OEmojiPicker.types.ts — single source of truth for all OEmojiPicker public
 * types. No types are declared inline in OEmojiPicker.vue.
 */

import type { I18nKey, I18nText } from "@/types/i18n";
import type { IconToken } from "./OGlyph.types";

/** One selectable icon plus the lowercase English terms that match it. */
export interface EmojiOption {
  /**
   * A Unicode emoji (including any variation selector) or an `o2:` registry
   * glyph reference. OGlyph decides how to render it.
   */
  token: IconToken;
  /** Matching data for search and suggestion — never rendered as copy. */
  keywords: readonly string[];
}

/** A labelled section of the catalog. */
export interface EmojiGroup {
  /** Stable identifier, used as the render key. */
  id: string;
  /** Section heading, resolved through `t()` at render time. */
  labelKey: I18nKey;
  emojis: readonly EmojiOption[];
}

/** Trigger footprint: `sm` pairs with a `sm` OInput, `md` with a `md` one. */
export type EmojiPickerSize = "sm" | "md";

export interface EmojiPickerProps {
  /** The chosen emoji, or null/empty for none. */
  modelValue?: string | null;
  /** Trigger footprint */
  size?: EmojiPickerSize;
  /** Disables the trigger and all interaction */
  disabled?: boolean;
  /** Accessible name for the trigger button */
  ariaLabel?: I18nText;
}

export interface EmojiPickerEmits {
  (_e: "update:modelValue", _value: string | null): void;
  /**
   * Fired only on a deliberate pick or clear by the user — never when the value
   * changes from outside. A caller that auto-fills the emoji uses this to stop
   * auto-filling (see FolderIconField).
   */
  (_e: "select", _value: string | null): void;
}
