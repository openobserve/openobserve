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
  onOverviewFocusRequest,
  overviewFocusListening,
  requestOverviewFocus,
} from "./goToRequests";

describe("goToRequests", () => {
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

  it("reports a listening ask field only while one is subscribed", () => {
    expect(overviewFocusListening.value).toBe(false);
    const offA = onOverviewFocusRequest(vi.fn());
    const offB = onOverviewFocusRequest(vi.fn());
    expect(overviewFocusListening.value).toBe(true);
    offA();
    expect(overviewFocusListening.value).toBe(true);
    offB();
    expect(overviewFocusListening.value).toBe(false);
  });
});
