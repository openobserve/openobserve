// Copyright 2026 OpenObserve Inc.

import type { MenuItemTone } from "@/lib/overlay/Dropdown/ODropdownItem.types";

const TONE: Record<MenuItemTone, string> = {
  default: "text-dropdown-item-text data-[highlighted]:bg-dropdown-item-hover-bg",
  danger:
    "text-dropdown-item-destructive-text data-[highlighted]:bg-dropdown-item-destructive-hover-bg",
};

/** One 32 px menu row in 13 px text (guidelines S1, T1), shared by dropdown and context menus. */
export function menuItemClasses(tone: MenuItemTone, unavailable: boolean, twoLine: boolean) {
  return [
    "group/item relative flex w-full items-center gap-2",
    "min-h-control-md rounded-default px-3 text-compact",
    twoLine ? "py-1" : "py-1.5",
    "cursor-pointer outline-none select-none",
    "transition-colors duration-(--duration-control) ease-(--ease-control)",
    unavailable
      ? "text-dropdown-item-disabled data-[highlighted]:bg-dropdown-item-hover-bg cursor-not-allowed"
      : TONE[tone],
    "data-[disabled]:text-dropdown-item-disabled data-[disabled]:cursor-not-allowed",
  ];
}

/** The menu surface: 200–320 wide, radius 8, 4 px inset (guideline O1). */
export const MENU_SURFACE =
  "min-w-50 max-w-80 p-1 bg-dropdown-bg rounded-menu shadow-overlay border border-transparent text-dropdown-item-text text-compact";
