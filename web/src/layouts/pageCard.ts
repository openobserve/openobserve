// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/** The card every page sits in; the assistant's side panel uses the same one. */
export const PAGE_CARD_CLASSES = {
  surface: "bg-surface-base flex min-h-0 flex-1 flex-col overflow-hidden",
  frame: "rounded-surface border shadow-md",
  // The border stays in light mode as transparent, so a theme switch never shifts content by 1 px.
  borderDark: "border-border-default",
  borderLight: "border-transparent",
} as const;

/** Kiosk mode drops the frame so the page runs edge to edge. */
export function pageCardClasses(kiosk: boolean, dark: boolean): string[] {
  return [
    PAGE_CARD_CLASSES.surface,
    kiosk ? "" : PAGE_CARD_CLASSES.frame,
    dark ? PAGE_CARD_CLASSES.borderDark : PAGE_CARD_CLASSES.borderLight,
  ];
}
