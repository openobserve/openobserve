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
  /** When provided, temporarily replaces the button label after click (e.g. "Copied!"). */
  successLabel?: string
}

/** A single entry in the collapsible "affected sections" detail list */
export interface ToastDetail {
  /** Human-readable resource label, e.g. "Dashboards" */
  label: string
  /** API path shown alongside the label, e.g. "/api/default/dashboards" */
  url: string
}

export interface ToastOptions {
  /** Visual style + icon set */
  variant?: ToastVariant
  /** Primary message text — plain string only (no HTML) */
  message: string
  /** Optional bold title above message */
  title?: string
  /** Numeric count rendered as an OBadge next to the title */
  titleCount?: number
  /** Auto-dismiss delay in ms. 0 = persistent. Defaults per variant. */
  timeout?: number
  /** Where the toast appears on screen */
  position?: ToastPosition
  /** Optional action button rendered inside the toast */
  action?: ToastAction
  /** Collapsible list of affected resources shown below the message */
  details?: ToastDetail[]
  /** Called once when this toast is dismissed (either by user or auto-timeout) */
  onDismiss?: () => void
}

export interface ToastProps extends ToastOptions {
  id: string
  open: boolean
  /** Number of identical toasts collapsed into this one; badge shown when > 1 */
  count?: number
  /** Increments each time a duplicate resets the timer; used to restart the progress bar animation */
  timerKey?: number
  details?: ToastDetail[]
  titleCount?: number
}

export interface ToastEmits {
  (e: "openChange", value: boolean): void
}
