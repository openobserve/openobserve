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

import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeRouter } from "../__tests__/fakeAssistant";
import { leaveFullThreadRoute } from "./useAssistantPlaces";

async function onChat(back: string | undefined) {
  const router = fakeRouter();
  await router.push("/?thread=b");
  await router.isReady();
  window.history.replaceState({ back }, "");
  vi.spyOn(router, "back").mockImplementation(() => {});
  vi.spyOn(router, "replace");
  vi.spyOn(router, "push");
  return router;
}

function stubNavigation(urls: string[]) {
  const origin = window.location.origin;
  const navigation = {
    currentEntry: { index: urls.length - 1 },
    entries: () => urls.map((url) => ({ url: url && origin + url })),
  };
  Object.defineProperty(window, "navigation", { value: navigation, configurable: true });
}

afterEach(() => {
  window.history.replaceState(null, "");
  Reflect.deleteProperty(window, "navigation");
  vi.restoreAllMocks();
});

describe("leaveFullThreadRoute", () => {
  it("goes back when the entry before the chat is another page", async () => {
    const router = await onChat("/logs");
    leaveFullThreadRoute(router, router.currentRoute.value);
    expect(router.back).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("goes to Home instead of reopening the previous chat", async () => {
    const router = await onChat("/?thread=a");
    leaveFullThreadRoute(router, router.currentRoute.value);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith(expect.objectContaining({ name: "home" }));
  });

  it("C-06: keeps Home's query and drops only the thread", async () => {
    const router = fakeRouter();
    await router.push("/?thread=b&period=7d&org_identifier=acme");
    await router.isReady();
    window.history.replaceState({ back: "/?thread=a" }, "");
    vi.spyOn(router, "replace");
    leaveFullThreadRoute(router, router.currentRoute.value);
    expect(router.replace).toHaveBeenCalledWith({
      name: "home",
      query: { period: "7d", org_identifier: "acme" },
    });
  });

  it("C-06: Back skips every chat the full view pushed and lands on the page before them", async () => {
    const router = await onChat("/?thread=a");
    stubNavigation(["/?period=7d", "/?thread=a&period=7d", "/?thread=b&period=7d"]);
    vi.spyOn(router, "go").mockImplementation(() => {});
    leaveFullThreadRoute(router, router.currentRoute.value);
    expect(router.go).toHaveBeenCalledWith(-2);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("falls back to Home when an earlier entry is not this app's", async () => {
    const router = await onChat("/?thread=a");
    stubNavigation(["", "/?thread=a", "/?thread=b"]);
    vi.spyOn(router, "go");
    leaveFullThreadRoute(router, router.currentRoute.value);
    expect(router.go).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith(expect.objectContaining({ name: "home" }));
  });

  it("goes to Home when there is no entry before", async () => {
    const router = await onChat(undefined);
    leaveFullThreadRoute(router, router.currentRoute.value);
    expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ name: "home" }));
  });
});
