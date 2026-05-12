export type ToastVariant =
  | "success"
  | "error"
  | "warning"
  | "info"
  | "loading"
  | "default"

// Positions mirror Quasar's subset actually used in the codebase
export type ToastPosition =
  | "top-center"
  | "top-right"
  | "top-left"
  | "bottom-center"
  | "bottom-right" // ← global default
  | "bottom-left"

export interface ToastAction {
  label: string
  handler: () => void
}

export interface ToastOptions {
  /** Visual style + icon set */
  variant?: ToastVariant
  /** Primary message text — plain string only (no HTML) */
  message: string
  /** Optional bold title above message */
  title?: string
  /** Auto-dismiss delay in ms. 0 = persistent. Defaults per variant. */
  timeout?: number
  /** Where the toast appears on screen */
  position?: ToastPosition
  /** Optional action button rendered inside the toast */
  action?: ToastAction
}

export interface ToastProps extends ToastOptions {
  id: string
  open: boolean
}

export interface ToastEmits {
  (e: "openChange", value: boolean): void
}
