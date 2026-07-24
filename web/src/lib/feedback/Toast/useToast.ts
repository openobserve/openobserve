import { reactive, ref } from "vue";
import type { ToastVariant, ToastOptions, ToastPosition, ToastDetail } from "./OToast.types";

// ── Internal record shape ────────────────────────────────────────────────────

interface ToastRecord {
  id: string;
  variant: ToastVariant;
  message: string;
  title?: string;
  timeout: number; // ms; 0 = persistent
  position: ToastPosition;
  open: boolean; // Reka controls enter/exit animation via this
  action?: ToastOptions["action"];
  count: number; // number of identical toasts collapsed into this one
  timerKey: number; // increments on each dedup reset; drives progress bar restart
  timer?: ReturnType<typeof setTimeout>; // auto-dismiss handle, reset on dedup
  timerStart?: number; // epoch ms when the current timer was started
  remainingTimeout?: number; // ms left when the timer was last paused
  details?: ToastDetail[];
  titleCount?: number;
  onDismiss?: () => void;
}

// ── Default timeouts per variant ─────────────────────────────────────────────

const defaultTimeouts: Record<ToastVariant, number> = {
  success: 5000,
  error: 30000,
  warning: 30000,
  info: 5000,
  loading: 0,
  default: 5000,
};

// ── Default positions per variant ────────────────────────────────────────────

const defaultPositions: Record<ToastVariant, ToastPosition> = {
  success: "bottom-center",
  error: "bottom-center",
  warning: "bottom-center",
  info: "bottom-center",
  loading: "bottom-center",
  default: "bottom-center",
};

// ── Module-level singleton — survives outside Vue lifecycle ──────────────────

const toastRecords = reactive<ToastRecord[]>([]);

let idCounter = 0;

// ── Page-visibility tracking (single listener for all toasts) ────────────────
// `visibilitychange` fires for both internal Chrome tab switching AND external
// app switching. Tracking it once at module level is more reliable than
// per-component listeners, which can race with Vue's reactive flush.

export const isPageVisible = ref(typeof document !== "undefined" ? !document.hidden : true);

function pauseAllTimers(): void {
  toastRecords.forEach((r) => pauseTimer(r.id));
}

function resumeAllTimers(): void {
  toastRecords.forEach((r) => resumeTimer(r.id));
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      isPageVisible.value = false;
      pauseAllTimers();
    } else {
      isPageVisible.value = true;
      resumeAllTimers();
    }
  });
}

// ── Public dismiss-function type ─────────────────────────────────────────────

type DismissFn = (replacement?: Pick<ToastOptions, "variant" | "message" | "title">) => void;

// ── Core toast() function ────────────────────────────────────────────────────

function scheduleAutoDismiss(record: ToastRecord, delay?: number): void {
  if (record.timer) {
    clearTimeout(record.timer);
    record.timer = undefined;
  }
  const ms = delay ?? record.timeout;
  if (ms > 0) {
    record.timerStart = Date.now();
    record.remainingTimeout = ms;
    record.timer = setTimeout(() => dismiss(record.id), ms);
  }
}

function pauseTimer(id: string): void {
  const record = toastRecords.find((r) => r.id === id);
  if (!record?.timer || !record.timerStart) return;
  clearTimeout(record.timer);
  record.timer = undefined;
  record.remainingTimeout = Math.max(
    0,
    (record.remainingTimeout ?? record.timeout) - (Date.now() - record.timerStart),
  );
  record.timerStart = undefined;
}

function resumeTimer(id: string): void {
  const record = toastRecords.find((r) => r.id === id);
  if (!record || record.timer || !record.remainingTimeout) return;
  record.timerStart = Date.now();
  record.timer = setTimeout(() => dismiss(record.id), record.remainingTimeout);
}

function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function toast(options: ToastOptions): DismissFn {
  const variant: ToastVariant = options.variant ?? "default";
  const position: ToastPosition = options.position ?? defaultPositions[variant];
  const timeout = options.timeout !== undefined ? options.timeout : defaultTimeouts[variant];

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
  );
  if (existing) {
    existing.count++;
    existing.timerKey++; // causes progress bar element to remount and restart
    scheduleAutoDismiss(existing); // keep it visible while duplicates arrive
    return makeDismissFn(existing.id, position);
  }

  const id = String(++idCounter);

  const record: ToastRecord = {
    id,
    variant,
    message: capitalizeFirst(options.message),
    title: options.title ? capitalizeFirst(options.title) : undefined,
    timeout,
    position,
    open: true,
    action: options.action,
    count: 1,
    timerKey: 0,
    details: options.details,
    titleCount: options.titleCount,
    onDismiss: options.onDismiss,
  };

  // Loading variant is suppressed — callers use the returned dismiss fn to
  // swap in a success/error result toast; no spinner is shown in the UI.
  if (variant !== "loading") {
    toastRecords.push(record);
    scheduleAutoDismiss(record);
  }

  return makeDismissFn(id, position);
}

// Update mutable fields of an existing open toast in-place.
// Used by the unauthorized-error grouper to append newly-failed resources
// to an already-visible notification rather than stacking a second one.
function updateToast(
  id: string,
  updates: { title?: string; message?: string; details?: ToastDetail[]; titleCount?: number },
): void {
  const record = toastRecords.find((r) => r.id === id);
  if (!record) return;
  if (updates.title !== undefined) record.title = capitalizeFirst(updates.title);
  if (updates.message !== undefined) record.message = capitalizeFirst(updates.message);
  if (updates.details !== undefined) record.details = updates.details;
  if (updates.titleCount !== undefined) record.titleCount = updates.titleCount;
}

function makeDismissFn(id: string, position: ToastPosition): DismissFn {
  return (replacement) => {
    dismiss(id);
    if (replacement) {
      toast({
        variant: replacement.variant,
        message: replacement.message,
        title: replacement.title,
        position,
      });
    }
  };
}

function dismiss(id: string): void {
  const record = toastRecords.find((r) => r.id === id);
  if (record) {
    if (record.timer) {
      clearTimeout(record.timer);
      record.timer = undefined;
    }
    record.open = false;
  }
}

// Remove every toast immediately. Used when the context changes (org switch,
// logout) and lingering notifications would be stale.
function dismissAll(): void {
  for (const record of toastRecords) {
    if (record.timer) {
      clearTimeout(record.timer);
      record.timer = undefined;
    }
  }
  toastRecords.splice(0, toastRecords.length);
}

// ── useToast composable — for use inside Vue components ─────────────────────

export interface UseToastReturn {
  toast: (options: ToastOptions) => DismissFn;
  toasts: ToastRecord[];
  dismissAll: () => void;
}

export function useToast(): UseToastReturn {
  return {
    toast,
    toasts: toastRecords,
    dismissAll,
  };
}

// ── Direct export — for use outside Vue tree (services, main.ts) ─────────────
export { toast, toastRecords, dismissAll, pauseTimer, resumeTimer, updateToast };
export type { ToastRecord, DismissFn };
