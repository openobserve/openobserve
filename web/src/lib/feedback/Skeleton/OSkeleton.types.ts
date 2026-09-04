/** Shape of the skeleton placeholder */
export type SkeletonType = "rect" | "circle" | "text";

/** Animation style */
export type SkeletonAnimation = "pulse" | "wave" | "none";

export interface SkeletonProps {
  /** Shape of the placeholder. Default: "rect" */
  type?: SkeletonType;
  /** Animation style. Default: "pulse" */
  animation?: SkeletonAnimation;
}
