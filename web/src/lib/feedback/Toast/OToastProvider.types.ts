export interface ToastProviderProps {
  // no public props — all state comes from the module-level store
}

/** Put on a bar docked at the bottom of the screen (a table footer, a sticky Save) so toasts stack above it. */
export const TOAST_AVOID_ATTR = "data-toast-avoid";

/** Only a marked bar whose bottom lies within this many rem of the viewport's bottom edge lifts the toasts. */
export const TOAST_AVOID_BAND_REM = 4;
