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

export interface ActivityTimer {
  touch: () => void;
  clear: () => void;
}

// A stream can stay open without sending anything, so a request with no first byte or a long silence is given up.
export function createActivityTimer(
  onTimeout: () => void,
  firstByteMs: number,
  idleMs: number,
): ActivityTimer {
  let handle: ReturnType<typeof setTimeout> | null = setTimeout(onTimeout, firstByteMs);
  return {
    touch() {
      if (handle === null) return;
      clearTimeout(handle);
      handle = setTimeout(onTimeout, idleMs);
    },
    clear() {
      if (handle !== null) clearTimeout(handle);
      handle = null;
    },
  };
}
