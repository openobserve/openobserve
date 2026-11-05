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

const goToHandlers = new Set<GoToHandler>();
const overviewFocusHandlers = new Set<() => void>();

export type GoToSource = "shortcut" | "editor";

type GoToHandler = (source: GoToSource) => void;

/** Asks the layout to open Go to; a no-op while nothing listens. */
export function requestGoTo(source: GoToSource): void {
  for (const handler of [...goToHandlers]) handler(source);
}

export function onGoToRequest(handler: GoToHandler): () => void {
  goToHandlers.add(handler);
  return () => {
    goToHandlers.delete(handler);
  };
}

/** Focuses the Home ask field; false when none is mounted, so the caller opens the palette instead. */
export function requestOverviewFocus(): boolean {
  if (overviewFocusHandlers.size === 0) return false;
  for (const handler of [...overviewFocusHandlers]) handler();
  return true;
}

export function onOverviewFocusRequest(handler: () => void): () => void {
  overviewFocusHandlers.add(handler);
  return () => {
    overviewFocusHandlers.delete(handler);
  };
}
