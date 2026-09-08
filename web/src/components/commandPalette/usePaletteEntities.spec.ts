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
  groups: PaletteScope[],
  impl: Partial<EntityProvider> = {},
): EntityProvider {
  return { id, groups, enabled: () => true, search: async () => [], ...impl };
}

const flush = async () => {
  await nextTick();
  await Promise.resolve();
  await nextTick();
};

const tick = async (ms: number) => {
  // Flush first so a just-changed ref lets its watcher schedule the debounce timer before the clock moves.
  await flush();
  vi.advanceTimersByTime(ms);
  await flush();
};

describe("usePaletteEntities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPaletteEntityCache();
  });
  afterEach(() => vi.useRealTimers());

  it("asks nothing while closed or on an empty query without scopes", async () => {
    const search = vi.fn().mockResolvedValue([item("dashboard:a")]);
    const open = ref(false);
    const query = ref("");
    const { entities } = usePaletteEntities({
      open,
      query,
      scopes: ref([]),
      org: ref("org1"),
      providers: ref([provider("resources", ["dashboards"], { search })]),
    });
    open.value = true;
    await tick(200);
    expect(search).not.toHaveBeenCalled();
    open.value = false;
    query.value = "a";
    await tick(200);
    expect(search).not.toHaveBeenCalled();
    expect(entities.value).toEqual([]);
  });

  it("debounces a typed query into one call carrying the scopes", async () => {
    const search = vi.fn().mockResolvedValue([item("dashboard:a")]);
    const query = ref("");
    const scopes = ref<PaletteScope[]>(["dashboards"]);
    const { entities } = usePaletteEntities({
      open: ref(true),
      query,
      scopes,
      org: ref("org1"),
      providers: ref([provider("resources", ["dashboards"], { search })]),
    });
    await tick(120);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0]).toBe("");
    query.value = "p";
    await flush();
    query.value = "pa";
    await tick(119);
    expect(search).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1][0]).toBe("pa");
    expect(search.mock.calls[1][1]).toEqual(["dashboards"]);
    expect(entities.value.map((i) => i.id)).toEqual(["dashboard:a"]);
  });

  it("serves a repeated query from the cache until it expires", async () => {
    const search = vi.fn().mockResolvedValue([item("alert:x", "alert")]);
    const query = ref("pay");
    const { entities } = usePaletteEntities({
      open: ref(true),
      query,
      scopes: ref([]),
      org: ref("org1"),
      providers: ref([provider("resources", ["reliability"], { search })]),
    });
    await tick(120);
    expect(search).toHaveBeenCalledTimes(1);
    query.value = "pa";
    await tick(120);
    query.value = "pay";
    await flush();
    expect(entities.value.map((i) => i.id)).toEqual(["alert:x"]);
    expect(search).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 61_000);
    query.value = "pa";
    await tick(120);
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("skips providers whose tiles are not selected, keeps others when one fails, and clears on close", async () => {
    const ok = vi.fn().mockResolvedValue([item("function:f", "function")]);
    const bad = vi.fn().mockRejectedValue(new Error("boom"));
    const off = vi.fn().mockResolvedValue([item("pipeline:p", "pipeline")]);
    const elsewhere = vi.fn().mockResolvedValue([item("user:u", "user")]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const open = ref(true);
    const { entities } = usePaletteEntities({
      open,
      query: ref("x"),
      scopes: ref(["data"]),
      org: ref("org1"),
      providers: ref([
        provider("functions", ["data"], { search: ok }),
        provider("alerts", ["data"], { search: bad }),
        provider("pipelines", ["data"], { search: off, enabled: () => false }),
        provider("users", ["iam"], { search: elsewhere }),
      ]),
    });
    await tick(120);
    expect(entities.value.map((i) => i.id)).toEqual(["function:f"]);
    expect(off).not.toHaveBeenCalled();
    expect(elsewhere).not.toHaveBeenCalled();
    open.value = false;
    await flush();
    expect(entities.value).toEqual([]);
  });
});
