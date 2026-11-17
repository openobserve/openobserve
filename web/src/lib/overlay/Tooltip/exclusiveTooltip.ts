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

// Closes the hover or focus tooltip on screen; each one sits in its own provider, so none closes another by itself.
let closeCurrent: (() => void) | null = null;

/** Records `close` as the open tooltip's, closing the one open before it. */
export function claimTooltip(close: () => void): void {
  if (closeCurrent && closeCurrent !== close) closeCurrent();
  closeCurrent = close;
}

/** Forgets `close` once its tooltip has shut. */
export function releaseTooltip(close: () => void): void {
  if (closeCurrent === close) closeCurrent = null;
}
