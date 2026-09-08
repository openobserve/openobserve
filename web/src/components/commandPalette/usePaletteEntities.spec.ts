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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick, ref } from "vue";
import {
  resetPaletteEntityCache,
  usePaletteEntities,
  type EntityProvider,
} from "./usePaletteEntities";
import type { PaletteItem, PaletteScope } from "./types";

const item = (id: string, type: PaletteItem["type"] = "dashboard"): PaletteItem => ({
  id,
  type,
  label: id,
  icon: "dashboard",
});

function provider(
  id: string,
  scope: PaletteScope,
  impl: Partial<EntityProvider> = {},
): EntityProvider {
  return { id, scope, enabled: () => true, ...impl };
}

const flush = async () => {
  await nextTick();
  await Promise.resolve();
  await nextTick();
};

describe("usePaletteEntities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPaletteEntityCache();
  });
  afterEach(() => vi.useRealTimers());

  it("lists on open, caches per org for the TTL, and refetches after it", async () => {
    const list = vi.fn().mockResolvedValue([item("dashboard:a")]);
    const open = ref(false);
    const org = ref("org1");
    const { entities } = usePaletteEntities({
      open,
      query: ref(""),
      scope: ref(null),
      org,
      providers: ref([provider("dashboards", "dashboard", { list })]),
    });
    open.value = true;
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    expect(entities.value.map((i) => i.id)).toEqual(["dashboard:a"]);
    open.value = false;
    await flush();
    open.value = true;
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 61_000);
    open.value = false;
    await flush();
    open.value = true;
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("debounces keyword search, honours the scope and drops results on close", async () => {
    const search = vi.fn().mockResolvedValue([item("stream:x", "stream")]);
    const other = vi.fn().mockResolvedValue([item("alert:y", "alert")]);
    const open = ref(true);
    const query = ref("");
    const scope = ref<PaletteScope | null>(null);
    const { entities } = usePaletteEntities({
      open,
      query,
      scope,
      org: ref("org1"),
      providers: ref([
        provider("streams", "stream", { search }),
        provider("alerts", "alert", { search: other }),
      ]),
    });
    query.value = "x";
    await flush();
    query.value = "xy";
    await flush();
    vi.advanceTimersByTime(119);
    expect(search).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0]).toBe("xy");
    expect(entities.value.map((i) => i.id).sort()).toEqual(["alert:y", "stream:x"]);
    scope.value = "stream";
    await flush();
    vi.advanceTimersByTime(120);
    await flush();
    expect(other).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(2);
    open.value = false;
    await flush();
    expect(entities.value).toEqual([]);
  });

  it("keeps other providers when one fails and skips disabled ones", async () => {
    const ok = vi.fn().mockResolvedValue([item("function:f", "function")]);
    const bad = vi.fn().mockRejectedValue(new Error("boom"));
    const off = vi.fn().mockResolvedValue([item("pipeline:p", "pipeline")]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { entities } = usePaletteEntities({
      open: ref(true),
      query: ref(""),
      scope: ref(null),
      org: ref("org1"),
      providers: ref([
        provider("functions", "function", { list: ok }),
        provider("alerts", "alert", { list: bad }),
        provider("pipelines", "pipeline", { list: off, enabled: () => false }),
      ]),
    });
    await flush();
    expect(entities.value.map((i) => i.id)).toEqual(["function:f"]);
    expect(off).not.toHaveBeenCalled();
  });
});
