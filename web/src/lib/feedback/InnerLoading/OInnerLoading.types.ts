import type { SpinnerSize } from "../Spinner/OSpinner.types";

/** Spinner size inside the overlay */
export type InnerLoadingSize = SpinnerSize;

export interface InnerLoadingProps {
  /** Controls overlay visibility */
  showing: boolean;
  /** Optional label shown beneath the spinner */
  label?: string;
  /** Spinner size. Default: "xs" */
  size?: InnerLoadingSize;
  /**
   * Paint the dimming scrim behind the spinner. Default: true.
   *
   * The scrim is `--color-inner-loading-overlay` — 70% of `--color-surface-base`
   * — so it only reads correctly over base-surface content it is actually
   * covering. Set false when this is a placeholder in empty space rather than an
   * overlay: with nothing behind it the scrim dims nothing, and on any surface
   * other than base it just paints a pale box.
   */
  scrim?: boolean;
}
