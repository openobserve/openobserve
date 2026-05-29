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
}
