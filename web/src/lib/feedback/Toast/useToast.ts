import { reactive } from "vue"
import type { ToastVariant, ToastOptions, ToastPosition } from "./OToast.types"

// ── Internal record shape ────────────────────────────────────────────────────

interface ToastRecord {
  id: string
  variant: ToastVariant
  message: string
  title?: string
  timeout: number // ms; 0 = persistent
  position: ToastPosition
  open: boolean // Reka controls enter/exit animation via this
  action?: ToastOptions["action"]
}

// ── Default timeouts per variant ─────────────────────────────────────────────

const defaultTimeouts: Record<ToastVariant, number> = {
  success: 3000,
  error: 5000,
  warning: 4000,
  info: 4000,
  loading: 0,
  default: 3000,
}

// ── Module-level singleton — survives outside Vue lifecycle ──────────────────

const toastRecords = reactive<ToastRecord[]>([])

let idCounter = 0

// ── Public dismiss-function type ─────────────────────────────────────────────

type DismissFn = (replacement?: Pick<ToastOptions, "variant" | "message" | "title">) => void

// ── Core toast() function ────────────────────────────────────────────────────

function toast(options: ToastOptions): DismissFn {
  const variant: ToastVariant = options.variant ?? "default"
  const position: ToastPosition = options.position ?? "bottom-right"
  const timeout =
    options.timeout !== undefined ? options.timeout : defaultTimeouts[variant]

  const id = String(++idCounter)

  const record: ToastRecord = {
    id,
    variant,
    message: options.message,
    title: options.title,
    timeout,
    position,
    open: true,
    action: options.action,
  }

  toastRecords.push(record)

  // Auto-dismiss when timeout > 0
  if (timeout > 0) {
    setTimeout(() => {
      dismiss(id)
    }, timeout)
  }

  const dismissFn: DismissFn = (replacement) => {
    dismiss(id)
    if (replacement) {
      toast({
        variant: replacement.variant,
        message: replacement.message,
        title: replacement.title,
        position,
      })
    }
  }

  return dismissFn
}

function dismiss(id: string): void {
  const record = toastRecords.find((r) => r.id === id)
  if (record) {
    record.open = false
  }
}

// ── useToast composable — for use inside Vue components ─────────────────────

export interface UseToastReturn {
  toast: (options: ToastOptions) => DismissFn
  toasts: ToastRecord[]
}

export function useToast(): UseToastReturn {
  return {
    toast,
    toasts: toastRecords,
  }
}

// ── Direct export — for use outside Vue tree (services, main.ts) ─────────────
export { toast, toastRecords }
export type { ToastRecord, DismissFn }
