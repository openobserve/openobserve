// Copyright 2026 OpenObserve Inc.

export type HorizontalStep = "forward" | "back";

// Same direction source as the nav keyboard handling (Header, ONavGroup).
const isRtl = () => document.documentElement.dir === "rtl";

/** Maps a physical arrow key to reading-order movement, which flips under rtl. */
export const horizontalStep = (key: string): HorizontalStep | null => {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  return (key === "ArrowRight") !== isRtl() ? "forward" : "back";
};
