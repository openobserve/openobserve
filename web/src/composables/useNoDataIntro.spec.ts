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

import { queryClient } from "@/composables/query/queryClient";
import stream from "@/services/stream";
import { streamNameListQuery } from "@/services/stream.queries";
import { USER_DATA_STREAM_TYPES } from "@/utils/internalStreams";

import { useNoDataIntro } from "./useNoDataIntro";

const ORG = "org1";
const lists = (logs: string[]) =>
  vi.spyOn(stream, "nameList").mockImplementation((async (_org: string, type: string) => ({
    data: { list: (type === "logs" ? logs : []).map((name) => ({ name })) },
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
    { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
  );
  return { showIntro, seen, wrapper };
}

describe("useNoDataIntro", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
  });

  it("shows the intro for an org with no data and keeps it when the lists later show data", async () => {
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
});
