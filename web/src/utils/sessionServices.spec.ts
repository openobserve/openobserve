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
import { expireSession, stopSessionServices } from "./sessionServices";

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

describe("expireSession", () => {
  const realLocation = window.location;
  afterEach(() => {
    vi.stubGlobal("location", realLocation);
    localStorage.clear();
  });

  it("stops the services, keeps the drafts and reloads without a leave prompt", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    localStorage.setItem("unrelated", "u");
    localStorage.setItem("o2_draft:function:o:f:me%40x.io", "{}");
    localStorage.setItem("o2_panel_draft:me@x.io:o:d:p", "{}");
    localStorage.setItem("o2_draft_signed_out", '["gone@x.io"]');
    const prompt = vi.fn();
    window.addEventListener("beforeunload", prompt);
    const store = { state: { zoConfig: { rum: { enabled: false } } }, dispatch: vi.fn() };

    expireSession(store, { clearLocalStorage: true });
    window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    window.removeEventListener("beforeunload", prompt);

    expect(closeSearchSocket).toHaveBeenCalledTimes(1);
    expect(store.dispatch).toHaveBeenCalledWith("logout");
    expect(localStorage.getItem("unrelated")).toBeNull();
    expect(localStorage.getItem("o2_draft:function:o:f:me%40x.io")).toBe("{}");
    expect(localStorage.getItem("o2_panel_draft:me@x.io:o:d:p")).toBe("{}");
    expect(localStorage.getItem("o2_draft_signed_out")).toBe('["gone@x.io"]');
    expect(prompt).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the assistant drafts when it clears sessionStorage", () => {
    vi.stubGlobal("location", { ...window.location, reload: vi.fn() });
    sessionStorage.setItem("o2.assistant.draft:k1:s1", "draft");
    sessionStorage.setItem("searchState", "x");
    const store = { state: { zoConfig: { rum: { enabled: false } } }, dispatch: vi.fn() };

    expireSession(store, { clearLocalStorage: true });

    expect(sessionStorage.getItem("o2.assistant.draft:k1:s1")).toBe("draft");
    expect(sessionStorage.getItem("searchState")).toBeNull();
    sessionStorage.clear();
  });

  it("goes to the login page instead of reloading when asked, keeping the drafts", () => {
    const reload = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload, assign });
    localStorage.setItem("o2_draft:function:o:f:me%40x.io", "{}");
    const store = { state: { zoConfig: { rum: { enabled: false } } }, dispatch: vi.fn() };

    expireSession(store, { toLogin: true });

    expect(store.dispatch).toHaveBeenCalledWith("logout");
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).toMatch(/login$/);
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem("o2_draft:function:o:f:me%40x.io")).toBe("{}");
  });
});
