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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/composables/fieldValueStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/fieldValueStore")>()),
  getFieldValuesForSuggestion: vi.fn().mockResolvedValue([]),
  requestFieldValues: vi.fn().mockResolvedValue(["critical"]),
}));

import { requestFieldValues } from "@/composables/fieldValueStore";
import SearchBar from "@/plugins/logs/SearchBar.vue";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

const MINUTE = 60_000_000;
const HOUR = 60 * MINUTE;
const END = 29_000_000 * MINUTE;

describe("SearchBar — value suggestions search the selected time range", () => {
  let wrapper: VueWrapper<any> | undefined;

  afterEach(() => {
    if (wrapper) {
      wrapper.vm.searchObj.data.stream.selectedStream = [];
      wrapper.vm.searchObj.data.datetime = {};
    }
    wrapper?.unmount();
    wrapper = undefined;
    vi.mocked(requestFieldValues).mockClear();
  });

  const mountAt = async (startTime: unknown, endTime: unknown) => {
    await router.replace({ name: "logs" });
    wrapper = mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: {
          UnifiedQueryEditor: {
            name: "UnifiedQueryEditor",
            template: '<div class="query-editor-stub" />',
            props: { valuesTimeRange: { type: Object, default: null } },
          },
        },
      },
    });
    wrapper.vm.searchObj.data.stream.selectedStream = ["app"];
    wrapper.vm.searchObj.data.datetime = { type: "absolute", startTime, endTime };
    await nextTick();
  };

  const editorRange = () =>
    wrapper!
      .findAllComponents({ name: "UnifiedQueryEditor" })
      .find((c) => c.attributes("data-test") === "logs-search-bar-query-editor")!
      .props("valuesTimeRange");

  const askedRange = async () => {
    await wrapper!.vm.resolveFieldValues("level");
    return (vi.mocked(requestFieldValues).mock.calls.at(-1)![2] as any)?.timeRange;
  };

  it("looks up values over a two-hour range, not the last fifteen minutes", async () => {
    await mountAt(END - 2 * HOUR, END);
    expect(await askedRange()).toEqual({ startTime: END - 2 * HOUR, endTime: END });
    expect(editorRange()).toEqual({ startTime: END - 2 * HOUR, endTime: END, capped: false });
  });

  it("looks up only the latest day of a week, and tells the editor so", async () => {
    await mountAt(END - 7 * 24 * HOUR, END);
    expect(await askedRange()).toEqual({ startTime: END - 24 * HOUR, endTime: END });
    expect(editorRange()).toMatchObject({ capped: true });
  });

  it("asks again over the new range once the range changes", async () => {
    await mountAt(END - 2 * HOUR, END);
    await askedRange();
    wrapper!.vm.searchObj.data.datetime = {
      type: "absolute",
      startTime: END - 26 * HOUR,
      endTime: END - 24 * HOUR,
    };
    await nextTick();
    expect(await askedRange()).toEqual({ startTime: END - 26 * HOUR, endTime: END - 24 * HOUR });
  });

  it("keeps the fifteen-minute lookback when the page has no usable range", async () => {
    await mountAt("Invalid Date", "Invalid Date");
    expect(await askedRange()).toBeUndefined();
    expect(editorRange()).toBeNull();
  });
});
