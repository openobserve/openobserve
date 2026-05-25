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
  count: number // number of identical toasts collapsed into this one
  timer?: ReturnType<typeof setTimeout> // auto-dismiss handle, reset on dedup
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

function scheduleAutoDismiss(record: ToastRecord): void {
  if (record.timer) {
    clearTimeout(record.timer)
    record.timer = undefined
  }
  if (record.timeout > 0) {
    record.timer = setTimeout(() => dismiss(record.id), record.timeout)
  }
}

function toast(options: ToastOptions): DismissFn {
  const variant: ToastVariant = options.variant ?? "default"
  const position: ToastPosition = options.position ?? "bottom-right"
  const timeout =
    options.timeout !== undefined ? options.timeout : defaultTimeouts[variant]

  // Collapse identical, still-open toasts into a single record with a count
  // badge instead of stacking duplicates (e.g. a polling request that keeps
  // returning the same 403).
  const existing = toastRecords.find(
    (r) =>
      r.open &&
      r.variant === variant &&
      r.message === options.message &&
      r.title === options.title &&
      r.position === position,
  )
  if (existing) {
    existing.count++
    scheduleAutoDismiss(existing) // keep it visible while duplicates arrive
    return makeDismissFn(existing.id, position)
  }

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
    count: 1,
  }

  toastRecords.push(record)
  scheduleAutoDismiss(record)

  return makeDismissFn(id, position)
}

function makeDismissFn(id: string, position: ToastPosition): DismissFn {
  return (replacement) => {
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
}

function dismiss(id: string): void {
  const record = toastRecords.find((r) => r.id === id)
  if (record) {
    if (record.timer) {
      clearTimeout(record.timer)
      record.timer = undefined
    }
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
