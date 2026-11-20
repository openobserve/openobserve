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
import { nextTick, ref } from "vue";
import { useLoadedAt } from "./useLoadedAt";

describe("useLoadedAt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });
  afterEach(() => vi.useRealTimers());

  it("stays empty while the first read is in flight", () => {
    const loadedAt = useLoadedAt(ref(true));
    expect(loadedAt.value).toBeNull();
  });

  it("stamps the time each read settles", async () => {
    const loading = ref(true);
    const loadedAt = useLoadedAt(loading);
    vi.setSystemTime(2_000);
    loading.value = false;
    await nextTick();
    expect(loadedAt.value).toBe(2_000);

    loading.value = true;
    await nextTick();
    expect(loadedAt.value).toBe(2_000);
    vi.setSystemTime(5_000);
    loading.value = false;
    await nextTick();
    expect(loadedAt.value).toBe(5_000);
  });

  it("stamps a view that starts idle", () => {
    const loadedAt = useLoadedAt(ref(false));
    expect(loadedAt.value).toBe(1_000);
  });
});
