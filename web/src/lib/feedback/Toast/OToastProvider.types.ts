import type { ToastPosition } from "./OToast.types";

export interface ToastProviderProps {
  // no public props — all state comes from the module-level store
}

// A fixed bottom row (the assistant's chat chips) sets --o-toast-lift so bottom toasts stack above it.
const BOTTOM = "bottom-[max(1rem,calc(var(--o-toast-lift,0rem)_+_0.5rem))]";

export const viewportPositionClasses: Record<ToastPosition, string> = {
  "top-center": ["fixed top-4 left-1/2 -translate-x-1/2", "flex flex-col gap-2 z-[9999]"].join(" "),
  "top-right": ["fixed top-4 end-4", "flex flex-col gap-2 z-[9999]"].join(" "),
  "top-left": ["fixed top-4 start-4", "flex flex-col gap-2 z-[9999]"].join(" "),
  "bottom-center": [
    `fixed ${BOTTOM} left-1/2 -translate-x-1/2`,
    "flex flex-col-reverse gap-2 z-[9999]",
  ].join(" "),
  "bottom-right": [`fixed ${BOTTOM} end-4`, "flex flex-col-reverse gap-2 z-[9999]"].join(" "),
  "bottom-left": ["fixed bottom-4 start-4", "flex flex-col-reverse gap-2 z-[9999]"].join(" "),
};
