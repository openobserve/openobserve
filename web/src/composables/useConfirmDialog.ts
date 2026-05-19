// Copyright 2026 OpenObserve Inc.

import { ref } from "vue";

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  persistent?: boolean;
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
