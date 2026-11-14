/** Ring diameter: sm 12, md 16 (default), lg 20 px. A spinner sits inside the busy control only. */
export type SpinnerSize = "sm" | "md" | "lg";

export const SPINNER_SIZES = ["sm", "md", "lg"] as const satisfies readonly SpinnerSize[];

export interface SpinnerProps {
  /** Ring diameter. Default: "md" */
  size?: SpinnerSize;
  /** Shows at once instead of after the 300 ms loader wait, for a host that already waited. Default: false */
  instant?: boolean;
}
