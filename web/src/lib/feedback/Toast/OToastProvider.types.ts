import type { ToastPosition } from "./OToast.types"

export interface ToastProviderProps {
  // no public props — all state comes from the module-level store
}

export const viewportPositionClasses: Record<ToastPosition, string> = {
  "top-center": [
    "tw:fixed tw:top-4 tw:left-1/2 tw:-translate-x-1/2",
    "tw:flex tw:flex-col tw:gap-2 tw:z-[9999]",
  ].join(" "),
  "top-right": [
    "tw:fixed tw:top-4 tw:end-4",
    "tw:flex tw:flex-col tw:gap-2 tw:z-[9999]",
  ].join(" "),
  "top-left": [
    "tw:fixed tw:top-4 tw:start-4",
    "tw:flex tw:flex-col tw:gap-2 tw:z-[9999]",
  ].join(" "),
  "bottom-center": [
    "tw:fixed tw:bottom-4 tw:left-1/2 tw:-translate-x-1/2",
    "tw:flex tw:flex-col-reverse tw:gap-2 tw:z-[9999]",
  ].join(" "),
  "bottom-right": [
    "tw:fixed tw:bottom-4 tw:end-4",
    "tw:flex tw:flex-col-reverse tw:gap-2 tw:z-[9999]",
  ].join(" "),
  "bottom-left": [
    "tw:fixed tw:bottom-4 tw:start-4",
    "tw:flex tw:flex-col-reverse tw:gap-2 tw:z-[9999]",
  ].join(" "),
}
