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
import { effectScope } from "vue";
import { NOW_TICK_MS, useNowMicros } from "./useNowMicros";

describe("useNowMicros", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves every minute while a view holds it, and stops when the last one leaves", () => {
    const first = effectScope();
    const second = effectScope();
    const a = first.run(() => useNowMicros())!;
    const b = second.run(() => useNowMicros())!;
    const opened = a.value;
    expect(opened).toBe(Date.parse("2026-10-09T10:00:00Z") * 1000);

    vi.advanceTimersByTime(NOW_TICK_MS);
    expect(a.value).toBe(opened + NOW_TICK_MS * 1000);
    expect(b.value).toBe(a.value);

    first.stop();
    vi.advanceTimersByTime(NOW_TICK_MS);
    expect(b.value).toBe(opened + 2 * NOW_TICK_MS * 1000);

    second.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
