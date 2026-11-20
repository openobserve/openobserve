/**
 * ODialog.types.ts — public types for ODialog.
 */

import type { I18nText } from "@/types/i18n";
import type { OverlayAction } from "@/lib/overlay/shared/overlayFooter.types";

export type { OverlayAction } from "@/lib/overlay/shared/overlayFooter.types";

/** sm 400 · md 560 · lg 720 (guideline O3); `full` only for content that needs the whole window. */
export type DialogSize = "sm" | "md" | "lg" | "full";

export const DIALOG_SIZES = ["sm", "md", "lg", "full"] as const satisfies readonly DialogSize[];

export interface DialogProps {
  /** Controlled open state — use with v-model:open */
  open?: boolean;

  /** Unsaved edits: Escape, ✕ and an outside click ask "Discard changes?" in the footer (V5). A nested OForm reports its own. */
  dirty?: boolean;

  /** A forced flow that cannot be dismissed: no ✕, and Escape and outside clicks do nothing. */
  persistent?: boolean;

  /** @default "md" */
  size?: DialogSize;

  /** The header ✕; turn it off only when the header slot draws its own close. @default true */
  showClose?: boolean;

  /** Header title, 15 px semibold. Ignored when the `header` slot is provided. */
  title?: I18nText;

  /** Accessible name when there is no visible `title`. */
  ariaTitle?: I18nText;

  /** One line under the title. */
  subtitle?: I18nText;

  /** Makes the primary a submit button of this form, so the form's own submit runs it. */
  formId?: string;

  /** Footer primary, right-most (guideline O7). */
  primary?: OverlayAction;
  /** Footer Cancel, left of the primary. */
  secondary?: OverlayAction;
  /** An extra action at the left of the footer (Test, Delete). */
  extra?: OverlayAction;
}

export interface DialogEmits {
  (e: "update:open", value: boolean): void;
  (e: "click:primary"): void;
  (e: "click:secondary"): void;
  (e: "click:extra"): void;
  /** The user chose Discard in the "Discard changes?" footer; the dialog then closes. */
  (e: "discard"): void;
}

export interface DialogSlots {
  /** The element that opens the dialog; omit when controlling it with v-model:open. */
  trigger?: () => unknown;
  /** Replaces the whole title block; `header-left` and `header-right` are then ignored. */
  header?: () => unknown;
  /** Content after the title, growing to fill the row. */
  "header-left"?: () => unknown;
  /** Content just before the close button. */
  "header-right"?: () => unknown;
  /** The body; the only part that scrolls (guideline O6). */
  default?: () => unknown;
  /** Replaces the built-in footer actions. */
  footer?: () => unknown;
  /** Content at the left of the built-in footer, before `extra`. */
  "footer-left"?: () => unknown;
}
