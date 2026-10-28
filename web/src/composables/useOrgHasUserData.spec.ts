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

import { EMPTY_LIST_STALE_TIME } from "@/composables/query/cachePolicy";
import { markDetectionSeen } from "@/composables/firstEvent/useFirstDataNotice";

import { orgHasUserData, refreshUserStreamLists, useOrgHasUserData } from "./useOrgHasUserData";

type Lists = Record<string, string[]>;

// The list endpoint's shape: stats come from flushed files, so a stream with none yet reads zero.
const listed = (name: string, type: string, docNum = 3) => ({
  name,
  storage_type: "s3",
  stream_type: type,
  stats: {
    created_at: 1_700_000_000_000_000,
    doc_time_min: docNum ? 1_700_000_000_000_000 : 0,
    doc_time_max: docNum ? 1_700_000_060_000_000 : 0,
    doc_num: docNum,
    file_num: docNum ? 1 : 0,
    storage_size: 0,
    compressed_size: 0,
    index_size: 0,
    mindex_size: 0,
  },
  schema: [],
  settings: {},
  total_fields: 0,
});

const listsFor = (byOrg: Record<string, Lists>, docNum = 3) =>
  vi.spyOn(stream, "nameList").mockImplementation((async (org: string, type: string) => ({
    data: { list: (byOrg[org]?.[type] ?? []).map((name) => listed(name, type, docNum)) },
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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

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

  it("does not count an empty, pre-created stream as data", async () => {
    listsFor({ org1: { logs: ["default"] } }, 0);
    const { result, wrapper } = setup("org1");
    await flushPromises();
    // Its stats cannot tell it from a stream whose first records are not flushed yet, so the answer waits.
    expect(result.hasUserData.value).toBeUndefined();
    wrapper.unmount();
  });

  // the guide turned green on records still in the WAL; onboarding opened next must send the user Home
  it("counts a stream with no stats yet once a setup page saw its first record arrive", async () => {
    listsFor({ seen: { logs: ["default"] } }, 0);
    const { result, wrapper } = setup("seen");
    await flushPromises();
    expect(result.hasUserData.value).toBeUndefined();

    markDetectionSeen("seen", { type: "logs", name: "default" });

    expect(result.hasUserData.value).toBe(true);
    queryClient.clear();
    expect(await orgHasUserData("seen")).toBe(true);
    wrapper.unmount();
  });

  // the streams were deleted and a new one pre-created: an old green bar says nothing about it
  it("does not count a detection once the stream it saw is gone, for a new empty stream", async () => {
    listsFor({ gone: { logs: ["default"] } });
    markDetectionSeen("gone", { type: "logs", name: "default" });
    queryClient.clear();
    expect(await orgHasUserData("gone")).toBe(true);
    vi.restoreAllMocks();

    listsFor({ gone: {} });
    queryClient.clear();
    expect(await orgHasUserData("gone")).toBe(false);
    vi.restoreAllMocks();

    listsFor({ gone: { logs: ["fresh"] } }, 0);
    const { result, wrapper } = setup("gone");
    await flushPromises();
    expect(result.hasUserData.value).toBeUndefined();
    queryClient.clear();
    expect(await orgHasUserData("gone")).toBeUndefined();
    // nor the same name in another signal
    vi.restoreAllMocks();
    listsFor({ gone: { metrics: ["default"] } }, 0);
    queryClient.clear();
    expect(await orgHasUserData("gone")).toBeUndefined();
    wrapper.unmount();
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

  // a page and the intro inside it mount together; data can still arrive with nothing watching
  it("shares one read between mounts while the org has no data, and asks again once it is old", async () => {
    const spy = listsFor({ org1: { logs: ["usage"] } });
    const first = setup("org1");
    await flushPromises();
    expect(first.result.hasUserData.value).toBe(false);
    expect(spy).toHaveBeenCalledTimes(3);
    const second = setup("org1", { keepCache: true });
    await flushPromises();
    expect(spy).toHaveBeenCalledTimes(3);
    vi.setSystemTime(Date.now() + EMPTY_LIST_STALE_TIME + 1);
    const third = setup("org1", { keepCache: true });
    await flushPromises();
    expect(spy).toHaveBeenCalledTimes(6);
    first.wrapper.unmount();
    second.wrapper.unmount();
    third.wrapper.unmount();
  });

  it.each([
    [
      "only O2's own and synthetics streams",
      { logs: ["usage"], metrics: ["synthetics_x"] },
      true,
      true,
    ],
    ["only metrics", { metrics: ["up"] }, true, false],
    ["no stream", {}, false, false],
  ])(
    "with %s, tells whether the org has any stream and any logs stream",
    async (_, byType, any, logs) => {
      listsFor({ org1: byType as Lists });
      const { result, wrapper } = setup("org1");
      expect(result.hasAnyStream.value).toBeUndefined();
      await flushPromises();
      expect(result.hasAnyStream.value).toBe(any);
      expect(result.hasLogsStream.value).toBe(logs);
      wrapper.unmount();
    },
  );

  it("reads the same answer once, outside a component, for a first login", async () => {
    listsFor({ org1: { logs: ["default"] }, org2: { logs: ["usage"] } });
    queryClient.clear();
    expect(await orgHasUserData("org1")).toBe(true);
    expect(await orgHasUserData("org2")).toBe(false);
    expect(await orgHasUserData("")).toBeUndefined();
    vi.spyOn(stream, "nameList").mockRejectedValue(new Error("down"));
    queryClient.clear();
    expect(await orgHasUserData("org1")).toBeUndefined();
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
