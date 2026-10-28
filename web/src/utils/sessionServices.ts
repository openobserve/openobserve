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

import { openobserveRum } from "@openobserve/browser-rum";
import { closeSearchSocket } from "@/composables/useSearchWebSocket";
import { dismissAll } from "@/lib/feedback/Toast/useToast";

export interface SessionServicesStore {
  state: { zoConfig?: { rum?: { enabled?: boolean } } };
}

/** Stops what outlives a page change: the search socket, AI chat streams, open toasts and the RUM user. */
export const stopSessionServices = (store: SessionServicesStore): void => {
  closeSearchSocket();
  // AI chat streams outlive their component by design, so sign-out stops them explicitly.
  window.dispatchEvent(new Event("o2:abort-ai-streams"));
  dismissAll();
  if (store.state.zoConfig?.rum?.enabled) {
    openobserveRum.stopSessionReplayRecording();
    openobserveRum.clearUser();
    openobserveRum.clearAccount();
  }
};
