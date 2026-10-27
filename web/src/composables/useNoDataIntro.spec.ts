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

import { FIRST_EVENT_BUDGET } from "@/composables/firstEvent/firstEventBudget";
import { queryClient } from "@/composables/query/queryClient";
import stream from "@/services/stream";
import { streamNameListQuery } from "@/services/stream.queries";
import store from "@/test/unit/helpers/store";
import { USER_DATA_STREAM_TYPES } from "@/utils/internalStreams";

import { useNoDataIntro } from "./useNoDataIntro";

const ORG = "org1";
const lists = (logs: string[]) =>
  vi.spyOn(stream, "nameList").mockImplementation((async (_org: string, type: string) => ({
    data: {
      list: (type === "logs" ? logs : []).map((name) => ({
        name,
        stream_type: type,
        stats: { doc_num: 3, doc_time_min: 1, doc_time_max: 2 },
      })),
    },
  })) as never);

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
