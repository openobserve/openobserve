// Copyright 2026 OpenObserve Inc.

import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import type { I18nText } from "@/types/i18n";

/** One footer action of a dialog or drawer; an action with no label is not drawn. */
export interface OverlayAction {
  label?: I18nText;
  /** @default "primary" for `primary`, "secondary" for `secondary`, "ghost" for `extra` */
  variant?: ButtonVariant;
  disabled?: boolean;
  /** With `disabled`, keeps the button focusable and says why in its tooltip (guideline B9). */
  disabledReason?: I18nText;
  loading?: boolean;
  dataTest?: string;
}

export interface OverlayFooterProps {
  primary?: OverlayAction;
  secondary?: OverlayAction;
  extra?: OverlayAction;
  /** Makes the primary a submit button of this form. */
  formId?: string;
  /** A nested OForm is mid-submit, so the primary shows its spinner. */
  formSubmitting?: boolean;
  /** "Discard changes?" replaces the footer (guideline V5). */
  asking?: boolean;
  /** `o-dialog` or `o-drawer`: the data-test prefix of the footer buttons. */
  testPrefix: "o-dialog" | "o-drawer";
}

export interface OverlayFooterEmits {
  (e: "primary"): void;
  (e: "secondary"): void;
  (e: "extra"): void;
  (e: "keep"): void;
  (e: "discard"): void;
}
