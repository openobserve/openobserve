// Copyright 2026 OpenObserve Inc.

import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import type { I18nKey, I18nText } from "@/types/i18n";

import { ref } from "vue";

export interface ConfirmDialogOptions {
  title: I18nText;
  message?: I18nText;
  // Takes precedence over `message`; the key must contain a {name} placeholder.
  messageKeypath?: I18nKey;
  messageName?: string;
  confirmLabel?: I18nText;
  cancelLabel?: I18nText;
  persistent?: boolean;
  confirmVariant?: ButtonVariant;
  // A destructive confirm starts on Cancel so Enter cannot confirm by accident.
  focusCancel?: boolean;
  /** Offers only the confirm button and cannot be dismissed, for a choice the user cannot refuse. */
  confirmOnly?: boolean;
}

interface DialogState extends ConfirmDialogOptions {
  open: boolean;
}

// Module-level singleton state — only one confirm dialog can be shown at a time
const dialogState = ref<DialogState | null>(null);
let pendingResolve: ((value: boolean) => void) | null = null;

export function useConfirmDialog() {
  const confirm = (options: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      pendingResolve = resolve;
      dialogState.value = {
        ...options,
        open: true,
      };
    });
  };

  const resolve = (value: boolean) => {
    if (pendingResolve) {
      pendingResolve(value);
      pendingResolve = null;
    }
    dialogState.value = null;
  };

  const handleConfirm = () => resolve(true);
  const handleCancel = () => resolve(false);
  const handleUpdateOpen = (open: boolean) => {
    if (!open) resolve(false);
  };

  return {
    /** Current dialog configuration for the provider to render */
    currentDialog: dialogState,
    /** Show a confirm dialog and return a Promise that resolves to user's choice */
    confirm,
    handleConfirm,
    handleCancel,
    handleUpdateOpen,
  };
}
