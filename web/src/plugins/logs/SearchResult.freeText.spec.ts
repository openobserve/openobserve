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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SearchResult from "@/plugins/logs/SearchResult.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";

const pushMock = vi.hoisted(() => vi.fn());

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push: pushMock, currentRoute: { value: { name: "logs", query: {} } } }),
}));

vi.mock("@/lib/core/Table/OTable.vue", () => ({
  __esModule: true,
  default: { name: "OTable", template: '<div data-test="otable-stub" />' },
}));

describe("SearchResult missing-stream banner (item 1 AC4.1)", () => {
  let wrapper: any;

  beforeEach(async () => {
    resetLogsAutoRunForTests();
    HTMLElement.prototype.scrollTo = vi.fn();
    wrapper = mount(SearchResult, {
      global: {
        provide: { store },
        plugins: [i18n],
        stubs: { DetailTable: true, ChartRenderer: true, ODrawer: true },
      },
      props: { expandedLogs: [] },
    });
    await flushPromises();
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    wrapper.vm.searchObj.loading = false;
  });

  afterEach(() => {
    wrapper.vm.searchObj.data.missingStreamMessage = "";
    wrapper.vm.searchObj.data.freeTextExcluded = [];
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("names the excluded stream and routes to its settings without writing anything", async () => {
    wrapper.vm.searchObj.data.missingStreamMessage = "Not searched: nofts_b (no full-text fields).";
    wrapper.vm.searchObj.data.freeTextExcluded = ["nofts_b"];
    await flushPromises();

    const banner = wrapper.find('[data-test="logs-missing-stream-banner"]');
    expect(banner.text()).toContain("nofts_b");
    expect(banner.text()).toContain("no full-text fields");

    await banner.find('[data-test="logs-no-fts-configure-btn"]').trigger("click");
    expect(pushMock).toHaveBeenCalledWith("/streams?dialog=nofts_b");
  });

  it("offers no configure action for a missing-field exclusion", async () => {
    wrapper.vm.searchObj.data.missingStreamMessage = "One or more filter fields do not exist";
    await flushPromises();

    const banner = wrapper.find('[data-test="logs-missing-stream-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.find('[data-test="logs-no-fts-configure-btn"]').exists()).toBe(false);
  });
});
