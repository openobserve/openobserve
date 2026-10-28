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

import { describe, it, expect, vi, afterEach } from "vitest";
import { openobserveRum } from "@openobserve/browser-rum";
import { closeSearchSocket } from "@/composables/useSearchWebSocket";
import { dismissAll } from "@/lib/feedback/Toast/useToast";
import { stopSessionServices } from "./sessionServices";

vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: {
    stopSessionReplayRecording: vi.fn(),
    clearUser: vi.fn(),
    clearAccount: vi.fn(),
  },
}));
vi.mock("@/composables/useSearchWebSocket", () => ({ closeSearchSocket: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ dismissAll: vi.fn() }));

describe("stopSessionServices", () => {
  afterEach(() => vi.clearAllMocks());

  it("closes the search socket, stops AI streams, clears toasts and resets the RUM user", () => {
    const aborted = vi.fn();
    window.addEventListener("o2:abort-ai-streams", aborted);
    stopSessionServices({ state: { zoConfig: { rum: { enabled: true } } } });
    window.removeEventListener("o2:abort-ai-streams", aborted);

    expect(closeSearchSocket).toHaveBeenCalledTimes(1);
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(dismissAll).toHaveBeenCalledTimes(1);
    expect(openobserveRum.stopSessionReplayRecording).toHaveBeenCalledTimes(1);
    expect(openobserveRum.clearUser).toHaveBeenCalledTimes(1);
    expect(openobserveRum.clearAccount).toHaveBeenCalledTimes(1);
  });

  it("leaves RUM alone when it is off", () => {
    stopSessionServices({ state: { zoConfig: { rum: { enabled: false } } } });
    expect(closeSearchSocket).toHaveBeenCalledTimes(1);
    expect(openobserveRum.clearUser).not.toHaveBeenCalled();
  });
});
