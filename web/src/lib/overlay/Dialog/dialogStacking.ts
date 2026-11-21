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

import { inject, provide } from "vue";

/** The inject key ODialog reads its stacking layer from (one layer per enclosing dialog). */
export const DIALOG_DEPTH_KEY = "o2DialogDepth";

/** The inject key ODrawer (and dropdowns inside one) read their stacking layer from. */
export const DRAWER_DEPTH_KEY = "o2DrawerDepth";

const LAYER_BASE = 6000;

const LAYER_STEP = 1000;

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

/** The z-indexes of a modal surface opened inside `depth` others: its scrim sits just under its content. */
export const overlayLayerZIndex = (depth: number) => ({
  overlayZIndex: LAYER_BASE - 1 + depth * LAYER_STEP,
  contentZIndex: LAYER_BASE + depth * LAYER_STEP,
});

/** How many dialogs, drawers or sheets the caller sits inside; a popover or menu takes their top layer. */
export const injectOverlayDepth = (): number =>
  Math.max(inject<number>(DIALOG_DEPTH_KEY, 0), inject<number>(DRAWER_DEPTH_KEY, 0));

/** One ladder for dialogs, drawers and sheets, so a confirm opened from any of them stacks above it. */
export const useOverlayLayer = (): number => {
  const depth = injectOverlayDepth();
  provide(DIALOG_DEPTH_KEY, depth + 1);
  provide(DRAWER_DEPTH_KEY, depth + 1);
  return depth;
};
