import type { I18nText } from "@/types/i18n";

/** success renders ok, error renders error, the rest neutral; loading adds a spinner. */
export type ToastVariant = "success" | "error" | "warning" | "info" | "loading" | "default";

export interface ToastAction {
  /** One word: Undo, View, Retry. */
  label: I18nText;
  handler: () => void;
  /** When provided, temporarily replaces the button label after click (e.g. "Copied!"). */
  successLabel?: I18nText;
}

export interface ToastOptions {
  variant?: ToastVariant;
  /** "<Object> <past verb>" on one line; a longer text is cut and shown in full on hover. */
  message: I18nText;
  /** Auto-dismiss delay in ms: 4 s by default, 8 s with an action; 0 keeps it until dismissed. */
  timeout?: number;
  action?: ToastAction;
  /** Called once when this toast is dismissed (either by user or auto-timeout) */
  onDismiss?: () => void;
}

export interface ToastProps extends ToastOptions {
  id: string;
  open: boolean;
  /** Number of identical toasts collapsed into this one; shown when > 1 */
  count?: number;
}

export interface ToastEmits {
  (e: "openChange", value: boolean): void;
}
