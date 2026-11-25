// Copyright 2026 OpenObserve Inc.

export const MENU_SURFACE_CLASS =
  "bg-dropdown-bg border-dropdown-border rounded-default shadow-overlay border p-1 text-dropdown-item-text text-compact";

export const MENU_ROW_CLASS = [
  "relative flex w-full min-h-7 max-md:min-h-9 items-center gap-2",
  "rounded-default ps-2 pe-4 py-0.5 text-compact text-start",
  "cursor-pointer outline-none select-none",
  "transition-colors duration-(--duration-control) ease-(--ease-control)",
].join(" ");

export const MENU_ROW_VARIANT_CLASS = {
  default: "text-dropdown-item-text data-[highlighted]:bg-dropdown-item-hover-bg",
  destructive:
    "text-dropdown-item-destructive-text data-[highlighted]:bg-dropdown-item-destructive-hover-bg",
} as const;

// Replaces the default variant rather than stacking on it, so the two text colours never compete.
export const MENU_ROW_SELECTED_CLASS =
  "bg-dropdown-item-selected-bg text-dropdown-item-selected-text data-[highlighted]:bg-dropdown-item-hover-bg";

export const MENU_LABEL_CLASS =
  "text-text-secondary px-2 pt-2 pb-1 text-xs font-medium select-none";

export const MENU_SEPARATOR_CLASS = "bg-dropdown-separator my-1 h-px";

const OWN_WIDTH = /(^|[\s:])(max-)?w-/;
const OWN_MAX_HEIGHT = /(^|[\s:])max-h-/;

/** Width and height caps for a menu surface; a cap the caller's class already sets is left to the caller. */
export function menuSizeClass(contentClass?: string): string[] {
  const own = contentClass ?? "";
  return [
    "min-w-48",
    OWN_WIDTH.test(own)
      ? "max-lg:max-w-[calc(100vw-1rem)]"
      : "max-w-[min(20rem,calc(100vw-1.5rem))]",
    OWN_MAX_HEIGHT.test(own)
      ? "max-lg:max-h-[var(--reka-popper-available-height,75vh)] max-lg:overflow-y-auto"
      : "max-h-[min(18rem,var(--reka-popper-available-height,18rem))] overflow-y-auto",
  ];
}
