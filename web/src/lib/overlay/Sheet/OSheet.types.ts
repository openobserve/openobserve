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

import type { I18nText } from "@/types/i18n";

export type SheetSnap = "peek" | "half" | "full";

/** Snap points from the smallest to the largest; a drag or a button always lands on one of them. */
export const SHEET_SNAPS: readonly SheetSnap[] = ["peek", "half", "full"];

export interface OSheetProps {
  open: boolean;
  /** `peek` is the 3.5 rem status row, `half` is 50 dvh, `full` reaches the app header. */
  snap: SheetSnap;
  snapPoints?: SheetSnap[];
  /** The dialog name; the sheet is `role="dialog" aria-modal="false"`. */
  ariaLabel: string;
  /** Session replay masks the portalled content, which sits outside any masked ancestor. */
  privacy?: "mask";
  /** A footer the sheet must stay above; defaults to the footer of the topmost open drawer. */
  anchorAbove?: string | HTMLElement;
  /** Swipe down past `peek` dismisses unless set. */
  persistent?: boolean;
  /** Prefix of every test id (`-handle`, `-expand`, `-peek`). */
  dataTest?: string;
  /** Label of the handle's grow button ("Show more"). */
  expandLabel: I18nText;
  /** Label of the handle's shrink button ("Show less"). */
  collapseLabel: I18nText;
  /** Keeps the content mounted while closed, so focus and state survive a close (`v-show`). */
  keepMounted?: boolean;
  /** Escape closes a non-persistent sheet; off when the consumer owns Escape. */
  closeOnEscape?: boolean;
  /** Renders in place instead of in `body`, so a sheet inside a modal drawer stays inside its focus scope. */
  inline?: boolean;
  /** Spans only this element's columns (a drawer narrower than the window) instead of the whole width. */
  alignTo?: HTMLElement | null;
}

export interface OSheetEmits {
  (e: "update:open", value: boolean): void;
  (e: "update:snap", value: SheetSnap): void;
  (e: "dismiss"): void;
}

export interface OSheetSlots {
  /** One row of chrome above the body. */
  header?: () => unknown;
  /** The scrolling body. */
  default?: () => unknown;
  footer?: () => unknown;
  /** At `peek` this one row replaces the handle and body; the whole row expands the sheet. */
  peek?: () => unknown;
}
