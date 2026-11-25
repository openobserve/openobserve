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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivityTimer } from "./activityTimer";

describe("createActivityTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires when no first byte arrives within 90 s", () => {
    const onTimeout = vi.fn();
    createActivityTimer(onTimeout, 90_000, 30_000);
    vi.advanceTimersByTime(89_999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("fires after 30 s of silence once the stream has started", () => {
    const onTimeout = vi.fn();
    const timer = createActivityTimer(onTimeout, 90_000, 30_000);
    vi.advanceTimersByTime(5_000);
    timer.touch();
    vi.advanceTimersByTime(29_999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("never fires on a request that keeps sending, however long it runs", () => {
    const onTimeout = vi.fn();
    const timer = createActivityTimer(onTimeout, 90_000, 30_000);
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(20_000);
      timer.touch();
    }
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("stops once the request settles", () => {
    const onTimeout = vi.fn();
    const timer = createActivityTimer(onTimeout, 90_000, 30_000);
    timer.clear();
    timer.touch();
    vi.advanceTimersByTime(200_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
