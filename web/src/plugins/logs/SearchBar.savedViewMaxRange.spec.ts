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

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createMemoryHistory } from "vue-router";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import { resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";

const { toastMock, getViewDetail, streamSettings } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  getViewDetail: vi.fn(),
  streamSettings: { max_query_range: 2 },
}));

vi.mock("@/services/saved_views", async () => {
  const actual = await vi.importActual<any>("@/services/saved_views");
  return { default: { ...actual.default, getViewDetail } };
});

vi.mock("@/lib/feedback/Toast/useToast", async () => {
  const actual = await vi.importActual<any>("@/lib/feedback/Toast/useToast");
  return { ...actual, toast: toastMock };
});

vi.mock("@/composables/useLogs/useStreamFields", async () => {
  const actual = await vi.importActual<any>("@/composables/useLogs/useStreamFields");
  return {
    ...actual,
    default: () => ({ ...actual.default(), extractFields: vi.fn(async () => undefined) }),
  };
});

vi.mock("@/composables/useStreams", async () => {
  const actual = await vi.importActual<any>("@/composables/useStreams");
  return {
    ...actual,
    default: (...args: any[]) => ({
      ...actual.default(...args),
      getStreams: vi.fn(async () => ({ list: [{ name: "app_logs", schema: [] }] })),
      getStream: vi.fn(async () => ({
        name: "app_logs",
        schema: [],
        settings: { ...streamSettings },
      })),
    }),
  };
});

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

const HOUR = 3600 * 1_000_000;
// Saved absolute window: 12:00 to 15:00 on a fixed day.
const END = Date.UTC(2026, 0, 15, 15, 0, 0) * 1000;
const START = END - 3 * HOUR;
const NOW_MS = Date.UTC(2026, 0, 16, 9, 30, 0);

const shortenedToast = {
  message: i18n.global.t("logs.searchBar.viewAppliedRangeShortened", { name: "My view", hours: 2 }),
  variant: "warning",
};

describe("SearchBar: saved view over the stream max query range", () => {
  let wrapper: VueWrapper<any> | undefined;
  let applied: any;

  const applyView = async (datetime: any, toastArg: object) => {
    wrapper = mount(SearchBar, {
      global: { provide: { store }, plugins: [i18n, router], stubs: { QueryEditor: true } },
    });
    const { searchObj } = wrapper.vm;
    searchObj.meta.logsVisualizeToggle = "logs";
    searchObj.data.stream.selectedStream = ["app_logs"];
    searchObj.data.stream.streamLists = [{ label: "app_logs", value: "app_logs" }];
    await flushPromises();
    const view = JSON.parse(JSON.stringify(wrapper.vm.getSearchObj()));
    view.data.stream.selectedStream = ["app_logs"];
    view.data.resultGrid = { ...(view.data.resultGrid ?? {}), colOrder: {}, colSizes: {} };
    view.data.datetime = datetime;
    getViewDetail.mockResolvedValueOnce({ status: 200, data: { data: view } });
    await wrapper.vm.applySavedView({ view_id: "v1", view_name: "My view" });
    await vi.waitFor(() => expect(toastMock).toHaveBeenCalledWith(toastArg));
    applied = { ...searchObj.data.datetime };
  };

  beforeEach(() => {
    resetLogsAutoRunForTests();
    toastMock.mockClear();
    applied = undefined;
    streamSettings.max_query_range = 2;
  });

  afterEach(async () => {
    await flushPromises();
    wrapper?.unmount();
    wrapper = undefined;
    vi.restoreAllMocks();
  });

  it("keeps the saved end of an absolute view and moves only the start", async () => {
    await applyView({ type: "absolute", startTime: START, endTime: END }, shortenedToast);
    expect(applied.type).toBe("absolute");
    expect(Number(applied.endTime)).toBe(END);
    expect(Number(applied.startTime)).toBe(END - 2 * HOUR);
    expect(shortenedToast.message).toContain("2 hours");
  });

  it("ends a relative view at now and starts max hours earlier", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
    await applyView(
      { type: "relative", relativeTimePeriod: "3h", startTime: START, endTime: END },
      shortenedToast,
    );
    expect(applied.type).toBe("relative");
    expect(Number(applied.endTime)).toBe(NOW_MS * 1000);
    expect(Number(applied.startTime)).toBe(NOW_MS * 1000 - 2 * HOUR);
  });

  it("leaves a view within the limit alone and shows the success toast", async () => {
    streamSettings.max_query_range = 5;
    await applyView(
      { type: "absolute", startTime: START, endTime: END },
      {
        message: i18n.global.t("logs.searchBar.viewAppliedSuccess", { name: "My view" }),
        variant: "success",
      },
    );
    expect(Number(applied.startTime)).toBe(START);
    expect(Number(applied.endTime)).toBe(END);
  });
});
