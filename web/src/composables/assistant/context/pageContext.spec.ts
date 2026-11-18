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

import { PAGE_CONTEXTS } from "../__fixtures__/pageContexts";
import { holdChatWindow, pageContext } from "./pageContext";

function fakeStore(timeOverride: { from: number; to: number } | null = null) {
  return {
    state: { sessions: { s1: { composer: { timeOverride } } } },
    setTimeOverride: vi.fn(),
  } as unknown as Parameters<typeof holdChatWindow>[0] & {
    setTimeOverride: ReturnType<typeof vi.fn>;
  };
}

describe("holdChatWindow", () => {
  afterEach(() => {
    pageContext.value = null;
  });

  it("pins the page's own range before a link moves the page", () => {
    pageContext.value = PAGE_CONTEXTS.logs;
    const store = fakeStore();
    holdChatWindow(store, "s1");
    expect(store.setTimeOverride).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ period: "15m" }),
    );
  });

  it("pins nothing on a page without a range, so the agent still picks the window", () => {
    pageContext.value = PAGE_CONTEXTS.dashboards;
    const store = fakeStore();
    holdChatWindow(store, "s1");
    expect(store.setTimeOverride).not.toHaveBeenCalled();
  });

  it("keeps a range the chat already holds", () => {
    pageContext.value = PAGE_CONTEXTS.logs;
    const store = fakeStore({ from: 1, to: 2 });
    holdChatWindow(store, "s1");
    expect(store.setTimeOverride).not.toHaveBeenCalled();
  });
});
