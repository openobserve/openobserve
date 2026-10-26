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
import { flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, h, ref } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import stream from "@/services/stream";
import { streamNameListQuery } from "@/services/stream.queries";

import { refreshUserStreamLists, useOrgHasUserData } from "./useOrgHasUserData";

type Lists = Record<string, string[]>;

const listsFor = (byOrg: Record<string, Lists>) =>
  vi.spyOn(stream, "nameList").mockImplementation((async (org: string, type: string) => ({
    data: { list: (byOrg[org]?.[type] ?? []).map((name) => ({ name })) },
  })) as never);

function setup(org: string, { keepCache = false } = {}) {
  if (!keepCache) queryClient.clear();
  const orgRef = ref(org);
  let result!: ReturnType<typeof useOrgHasUserData>;
  const wrapper = mount(
    defineComponent({
      setup() {
        result = useOrgHasUserData(orgRef);
        return () => h("div");
      },
    }),
    { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
  );
  return { orgRef, result, wrapper };
}

async function run(byType: Lists) {
  listsFor({ org1: byType });
  const { result, wrapper } = setup("org1");
  const before = result.hasUserData.value;
  await flushPromises();
  const after = result.hasUserData.value;
  wrapper.unmount();
  return { before, after };
}

describe("useOrgHasUserData", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is undefined while loading, then true for a user stream", async () => {
    expect(await run({ logs: ["default"] })).toEqual({ before: undefined, after: true });
  });

  it("is false when only internal and synthetic streams exist", async () => {
    const { after } = await run({
      logs: ["usage", "_o2_db_stats", "synthetics_results"],
      metrics: ["synthetics_step_results"],
    });
    expect(after).toBe(false);
  });

  it("counts a traces stream", async () => {
    expect((await run({ traces: ["checkout"] })).after).toBe(true);
  });

  it("counts a metrics-only stream", async () => {
    expect((await run({ metrics: ["up"] })).after).toBe(true);
  });

  it("stays undefined when a list fails and no stream was found", async () => {
    vi.spyOn(stream, "nameList").mockRejectedValue(new Error("down"));
    const { result, wrapper } = setup("org1");
    await flushPromises();
    expect(result.hasUserData.value).toBeUndefined();
    wrapper.unmount();
  });

  it("asks nothing while the org is empty, then follows an org switch", async () => {
    const spy = listsFor({ org1: { logs: ["default"] }, org2: {} });
    const { orgRef, result, wrapper } = setup("");
    await flushPromises();
    expect(spy).not.toHaveBeenCalled();
    expect(result.hasUserData.value).toBeUndefined();
    orgRef.value = "org1";
    await flushPromises();
    expect(result.hasUserData.value).toBe(true);
    orgRef.value = "org2";
    await flushPromises();
    expect(result.hasUserData.value).toBe(false);
    wrapper.unmount();
  });

  it("asks again on every mount while the org has no data", async () => {
    const spy = listsFor({ org1: { logs: ["usage"] } });
    const first = setup("org1");
    await flushPromises();
    expect(first.result.hasUserData.value).toBe(false);
    expect(spy).toHaveBeenCalledTimes(3);
    const second = setup("org1", { keepCache: true });
    await flushPromises();
    expect(spy).toHaveBeenCalledTimes(6);
    first.wrapper.unmount();
    second.wrapper.unmount();
  });

  it("keeps the cached lists for their usual time once the org has data", async () => {
    const spy = listsFor({ org1: { metrics: ["up"] } });
    const first = setup("org1");
    await flushPromises();
    expect(first.result.hasUserData.value).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3);
    const second = setup("org1", { keepCache: true });
    await flushPromises();
    expect(second.result.hasUserData.value).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3);
    first.wrapper.unmount();
    second.wrapper.unmount();
  });

  it("refreshes every user stream list after the first data, so no page reads an empty cache", async () => {
    queryClient.clear();
    const lists: Lists = {};
    listsFor({ org1: lists });
    const read = (type: string) =>
      queryClient.fetchQuery(streamNameListQuery("org1", type)).then((l) => l.map((s) => s.name));
    // Cached while the org was empty.
    for (const type of ["logs", "metrics", "traces"]) expect(await read(type)).toEqual([]);
    lists.logs = ["default"];
    lists.metrics = ["up"];
    lists.traces = ["default"];
    expect(await read("traces")).toEqual([]);
    await refreshUserStreamLists("org1");
    expect(await read("logs")).toEqual(["default"]);
    expect(await read("metrics")).toEqual(["up"]);
    expect(await read("traces")).toEqual(["default"]);
  });
});
