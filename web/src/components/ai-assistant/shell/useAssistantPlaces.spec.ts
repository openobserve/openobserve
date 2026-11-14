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

afterEach(() => {
  window.history.replaceState(null, "");
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
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("goes to Home when there is no entry before", async () => {
    const router = await onChat(undefined);
    leaveFullThreadRoute(router, router.currentRoute.value);
    expect(router.push).toHaveBeenCalledWith("/");
  });
});
