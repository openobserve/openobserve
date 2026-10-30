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

import { provide } from "vue";

/** The inject key ODialog reads its stacking layer from (one layer per enclosing dialog). */
export const DIALOG_DEPTH_KEY = "o2DialogDepth";

/** Open ODialog/ODrawer panels in the page; each holds at most one stacking layer. */
export const countOpenOverlays = (root: ParentNode = document): number =>
  root.querySelectorAll('[role="dialog"][data-state="open"]').length;

/**
 * For a dialog opened from outside the component tree of whatever is already open (an app-level
 * dialog): call in the parent's setup, right before the ODialog mounts, to stack it above them.
 */
export const provideDialogLayerAboveOpenOverlays = (root?: ParentNode): number => {
  const depth = typeof document === "undefined" ? 0 : countOpenOverlays(root);
  provide(DIALOG_DEPTH_KEY, depth);
  return depth;
};
