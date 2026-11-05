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

import { describe, expect, it, vi } from "vitest";

import {
  onGoToRequest,
  onOverviewFocusRequest,
  requestGoTo,
  requestOverviewFocus,
} from "./goToRequests";

describe("goToRequests", () => {
  it("passes the source to every subscriber until it unsubscribes", () => {
    const handler = vi.fn();
    const off = onGoToRequest(handler);
    requestGoTo("shortcut");
    requestGoTo("editor");
    expect(handler.mock.calls).toEqual([["shortcut"], ["editor"]]);
    off();
    requestGoTo("shortcut");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("is a no-op with no Go to subscriber", () => {
    expect(() => requestGoTo("shortcut")).not.toThrow();
  });

  it("returns false from requestOverviewFocus when no Home ask field listens", () => {
    expect(requestOverviewFocus()).toBe(false);
  });

  it("focuses the listening ask field and returns true, then false after it unsubscribes", () => {
    const focus = vi.fn();
    const off = onOverviewFocusRequest(focus);
    expect(requestOverviewFocus()).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
    off();
    expect(requestOverviewFocus()).toBe(false);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("keeps the two channels apart", () => {
    const goTo = vi.fn();
    const focus = vi.fn();
    const offGoTo = onGoToRequest(goTo);
    const offFocus = onOverviewFocusRequest(focus);
    requestGoTo("editor");
    expect(focus).not.toHaveBeenCalled();
    requestOverviewFocus();
    expect(goTo).toHaveBeenCalledTimes(1);
    offGoTo();
    offFocus();
  });

  it("lets a handler unsubscribe itself while being called", () => {
    const later = vi.fn();
    const off = onGoToRequest(() => off());
    const offLater = onGoToRequest(later);
    requestGoTo("shortcut");
    expect(later).toHaveBeenCalledTimes(1);
    offLater();
  });
});
