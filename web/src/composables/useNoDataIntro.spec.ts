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
import { defineComponent, h, watch } from "vue";

import config from "@/aws-exports";
import { FIRST_EVENT_BUDGET } from "@/composables/firstEvent/firstEventBudget";
import { queryClient } from "@/composables/query/queryClient";
import stream from "@/services/stream";
import { streamNameListQuery } from "@/services/stream.queries";
import { streamKeys } from "@/services/stream.querykeys";
import store from "@/test/unit/helpers/store";
import { USER_DATA_STREAM_TYPES } from "@/utils/internalStreams";

import { useNoDataIntro, useSetupTarget } from "./useNoDataIntro";

const ORG = "org1";
const CLOUD = config.isCloud;
const lists = (logs: string[], { docNum = 3, metrics = [] as string[] } = {}) =>
  vi.spyOn(stream, "nameList").mockImplementation((async (_org: string, type: string) => ({
    data: {
      list: (type === "logs" ? logs : type === "metrics" ? metrics : []).map((name) => ({
        name,
        stream_type: type,
        stats: { doc_num: docNum, doc_time_min: docNum ? 1 : 0, doc_time_max: docNum ? 2 : 0 },
      })),
    },
  })) as never);
const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

/** Mounts the composable and records every value it takes. */
function setup() {
  const seen: (boolean | undefined)[] = [];
  let showIntro!: ReturnType<typeof useNoDataIntro>;
  const wrapper = mount(
    defineComponent({
      setup() {
        showIntro = useNoDataIntro(ORG);
        watch(showIntro, (v) => seen.push(v), { immediate: true });
        return () => h("div");
      },
    }),
    { global: { plugins: [[VueQueryPlugin, { queryClient }], store] } },
  );
  return { showIntro, seen, wrapper };
}

describe("useNoDataIntro", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    queryClient.clear();
    store.state.zoConfig.restricted_routes_on_empty_data = false;
    setVisibility("visible");
    config.isCloud = CLOUD;
  });

  // the _meta org, an org O2 writes triggers or usage into, a synthetics-only org
  it.each([
    ["O2's own streams", ["usage", "triggers"]],
    ["synthetics results", ["synthetics_results"]],
  ])("keeps the query UI for an org whose only logs streams are %s", async (_, names) => {
    queryClient.clear();
    lists(names);
    const { showIntro, seen, wrapper } = setup();
    await flushPromises();

    expect(showIntro.value).toBe(false);
    expect(seen).not.toContain(true);
    wrapper.unmount();
  });

  it("shows the intro for an org with metrics but no logs stream", async () => {
    queryClient.clear();
    lists([], { metrics: ["up"] });
    const { showIntro, wrapper } = setup();
    await flushPromises();

    expect(showIntro.value).toBe(true);
    wrapper.unmount();
  });

  // its records sit in the WAL until the first file flushes, and the query UI can search them
  it("keeps the query UI for a logs stream whose stats are not flushed yet", async () => {
    queryClient.clear();
    lists(["default"], { docNum: 0 });
    const { showIntro, wrapper } = setup();
    await flushPromises();

    expect(showIntro.value).toBe(false);
    wrapper.unmount();
  });

  it("with the flag off, keeps the intro when a re-read fails", async () => {
    vi.useFakeTimers();
    queryClient.clear();
    lists([]);
    const { showIntro, wrapper } = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(showIntro.value).toBe(true);

    vi.spyOn(stream, "nameList").mockRejectedValue(new Error("401"));
    await vi.advanceTimersByTimeAsync(FIRST_EVENT_BUDGET.fastMs);

    expect(showIntro.value).toBe(true);
    wrapper.unmount();
  });

  it("with the flag off, re-reads only the logs list, and nothing while the tab is hidden", async () => {
    vi.useFakeTimers();
    queryClient.clear();
    const spy = lists([]);
    const reads = (type: string) => spy.mock.calls.filter((c) => c[1] === type).length;
    const { wrapper } = setup();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(FIRST_EVENT_BUDGET.fastMs);
    expect(reads("logs")).toBe(2);
    expect(reads("metrics")).toBe(1);

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(FIRST_EVENT_BUDGET.fastMs * 4);
    expect(reads("logs")).toBe(2);

    // back from the terminal: read at once, then on the cadence
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(reads("logs")).toBe(3);
    await vi.advanceTimersByTimeAsync(FIRST_EVENT_BUDGET.fastMs);
    expect(reads("logs")).toBe(4);
    expect(reads("metrics")).toBe(1);
    wrapper.unmount();
  });

  it("stops reading once unmounted", async () => {
    vi.useFakeTimers();
    queryClient.clear();
    const spy = lists([]);
    const { wrapper } = setup();
    await vi.advanceTimersByTimeAsync(0);
    wrapper.unmount();
    const before = spy.mock.calls.length;

    await vi.advanceTimersByTimeAsync(FIRST_EVENT_BUDGET.fastMs * 3);
    setVisibility("hidden");
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);

    expect(spy.mock.calls.length).toBe(before);
  });

  it("with the flag on, keeps the intro when the lists later show data, for FirstDataPanel's report", async () => {
    store.state.zoConfig.restricted_routes_on_empty_data = true;
    queryClient.clear();
    lists([]);
    const { showIntro, wrapper } = setup();
    await flushPromises();
    expect(showIntro.value).toBe(true);

    // the first-data watcher refreshes the lists before it reports
    lists(["default"]);
    await queryClient.refetchQueries();
    await flushPromises();

    expect(showIntro.value).toBe(true);
    wrapper.unmount();
  });

  // FirstDataPanel's watch never reports a stream O2 writes itself, so the list has to end the intro
  it("with the flag on, ends the intro when the first logs stream is O2's own", async () => {
    store.state.zoConfig.restricted_routes_on_empty_data = true;
    queryClient.clear();
    lists([]);
    const { showIntro, wrapper } = setup();
    await flushPromises();
    expect(showIntro.value).toBe(true);

    lists(["usage"]);
    await queryClient.refetchQueries();
    await flushPromises();

    expect(showIntro.value).toBe(false);
    wrapper.unmount();
  });

  // the list was cached empty moments before the first stream landed; FirstDataPanel's watch takes
  // that stream as its starting point and never reports it
  it("with the flag on, ends the intro when the live list already holds a logs stream", async () => {
    store.state.zoConfig.restricted_routes_on_empty_data = true;
    queryClient.clear();
    for (const type of USER_DATA_STREAM_TYPES) {
      queryClient.setQueryData(streamNameListQuery(ORG, type).queryKey, []);
    }
    lists(["default"], { docNum: 0 });
    const { showIntro, wrapper } = setup();
    expect(showIntro.value).toBe(true);

    // the watch's own first read of the list
    await queryClient.fetchQuery({ ...streamNameListQuery(ORG, "logs"), staleTime: 0 });
    await flushPromises();

    expect(showIntro.value).toBe(false);
    wrapper.unmount();
  });

  it("with the flag on, from a cached empty list, still waits for FirstDataPanel when data lands later", async () => {
    store.state.zoConfig.restricted_routes_on_empty_data = true;
    queryClient.clear();
    for (const type of USER_DATA_STREAM_TYPES) {
      queryClient.setQueryData(streamNameListQuery(ORG, type).queryKey, []);
    }
    lists([]);
    const { showIntro, wrapper } = setup();
    await flushPromises();
    expect(showIntro.value).toBe(true);

    lists(["default"], { docNum: 0 });
    await queryClient.refetchQueries();
    await flushPromises();

    expect(showIntro.value).toBe(true);
    wrapper.unmount();
  });

  it("never shows the intro from a stale cached 'no data' that refetches to data", async () => {
    queryClient.clear();
    for (const type of USER_DATA_STREAM_TYPES) {
      queryClient.setQueryData(streamNameListQuery(ORG, type).queryKey, [], {
        updatedAt: Date.now() - 60 * 60 * 1000,
      });
    }
    lists(["default"]);
    const { showIntro, seen, wrapper } = setup();
    await flushPromises();

    expect(showIntro.value).toBe(false);
    expect(seen).not.toContain(true);
    wrapper.unmount();
  });

  // the intro re-reads the logs list on a timer, so a card clicked mid-read must still open onboarding
  it("on cloud, keeps the onboarding target while a re-read is in flight, then follows its answer", async () => {
    config.isCloud = "true";
    queryClient.clear();
    lists([]);
    let target!: ReturnType<typeof useSetupTarget>["target"];
    const wrapper = mount(
      defineComponent({
        setup() {
          ({ target } = useSetupTarget(ORG));
          return () => h("div");
        },
      }),
      { global: { plugins: [[VueQueryPlugin, { queryClient }], store] } },
    );
    const opens = () => target("logs", "curl", "over-http-with-curl").name;
    await flushPromises();
    expect(opens()).toBe("onboarding");

    let answer!: (v: unknown) => void;
    vi.spyOn(stream, "nameList").mockReturnValue(new Promise((r) => (answer = r)) as never);
    void queryClient.invalidateQueries({ queryKey: streamKeys.nameList(ORG, "logs"), exact: true });
    await flushPromises();
    expect(queryClient.isFetching()).toBe(1);
    expect(opens()).toBe("onboarding");

    answer({ data: { list: [{ name: "default", stream_type: "logs", stats: { doc_num: 1 } }] } });
    await flushPromises();
    expect(opens()).toBe("curl");
    wrapper.unmount();
  });

  it("with the flag off, reads the lists again, leaves once data appears, and never comes back", async () => {
    vi.useFakeTimers();
    queryClient.clear();
    lists([]);
    const { showIntro, seen, wrapper } = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(showIntro.value).toBe(true);

    lists(["default"]);
    await vi.advanceTimersByTimeAsync(FIRST_EVENT_BUDGET.fastMs);
    expect(showIntro.value).toBe(false);

    lists([]);
    void queryClient.refetchQueries();
    await vi.advanceTimersByTimeAsync(FIRST_EVENT_BUDGET.fastMs);
    expect(seen).toEqual([undefined, true, false]);
    wrapper.unmount();
  });
});
