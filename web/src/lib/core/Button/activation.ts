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

// A menu trigger also opens on the arrow keys, so a busy control must swallow those too.
const ACTIVATION_KEYS = new Set(["Enter", " ", "ArrowDown", "ArrowUp"]);

/** True for a pointer event, or a key that would activate a button or open its menu. */
export const activates = (event: Event): boolean =>
  !(event instanceof KeyboardEvent) || ACTIVATION_KEYS.has(event.key);
