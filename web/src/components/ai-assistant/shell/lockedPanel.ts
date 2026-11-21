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

import { shallowRef } from "vue";

/** Who opened the locked sidebar, so focus can return there. */
export interface LockedPanelState {
  invoker: HTMLElement | null;
}

// The store is inert on G2 and writes no placement (`00` §4.2 rule 8), so the locked sidebar is view state.
const lockedPanel = /* @__PURE__ */ shallowRef<LockedPanelState | null>(null);

// Set when the panel closed by moving to the full view, which takes the focus and says nothing of a close.
let movedToFullView = false;

/** The open locked sidebar, or null; read by the sidebar host and the header button. */
export function useLockedPanel() {
  return lockedPanel;
}

export function openLockedPanel(invoker: HTMLElement | null): void {
  movedToFullView = false;
  lockedPanel.value = { invoker };
}

/** `move` hands the session to the `/assistant` hero instead of closing it. */
export function closeLockedPanel(reason: "close" | "move" = "close"): void {
  movedToFullView = reason === "move";
  lockedPanel.value = null;
}

/** True while the last close was a move to the full view; the host skips its close announcement. */
export function lockedPanelMoved(): boolean {
  return movedToFullView;
}

/** Read once by the full view, which then focuses its hero; later opens start clean. */
export function takeLockedMove(): boolean {
  const moved = movedToFullView;
  movedToFullView = false;
  return moved;
}
