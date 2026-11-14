/** A text line (12 px tall by default), a layout box, or an avatar circle. */
export type SkeletonShape = "line" | "block" | "circle";

/** Whole-layout skeletons for the three common first-load shapes (K4). */
export type SkeletonPreset = "tableRows" | "statStrip" | "chart";

export const SKELETON_SHAPES = [
  "line",
  "block",
  "circle",
] as const satisfies readonly SkeletonShape[];

export const SKELETON_PRESETS = [
  "tableRows",
  "statStrip",
  "chart",
] as const satisfies readonly SkeletonPreset[];

export interface SkeletonProps {
  /** Shape of a single placeholder; ignored when `preset` is set. Default: "line" */
  shape?: SkeletonShape;
  /** Renders a whole layout instead of one shape. */
  preset?: SkeletonPreset;
  /** Row count of the `tableRows` preset. Default: 5 */
  rows?: number;
  /** Tile count of the `statStrip` preset. Default: 4 */
  count?: number;
  /** Milliseconds before the skeleton shows, so a fast load never flashes one. Default: 150 */
  delay?: number;
}
