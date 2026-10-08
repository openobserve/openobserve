//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { nextTick, ref } from "vue";

/** Text of `traces-row-nav-live`; rendered by the traces page, so a failure that swaps the results for an error state is still announced. */
export const tracesRowNavAnnouncement = ref("");

// Re-setting the same text is not re-announced, so the region is emptied first.
export function announceTracesRowNav(message: string): void {
  tracesRowNavAnnouncement.value = "";
  nextTick(() => {
    tracesRowNavAnnouncement.value = message;
  });
}
