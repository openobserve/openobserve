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
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createMemoryHistory } from "vue-router";
import SearchBar from "@/plugins/logs/SearchBar.vue";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

describe("SearchBar — Filter | SQL query mode", () => {
  let wrapper: VueWrapper<any> | undefined;

  // jsdom lays nothing out; a desktop-wide bar keeps the tray on the toolbar instead of in ⋯.
  const mountSearchBar = () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const isToolbarBar =
        this.classList.contains("border-border-default") &&
        this.classList.contains("overflow-hidden");
      return { width: isToolbarBar ? 1600 : 0 } as DOMRect;
    });
    return mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true },
      },
    });
  };

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.restoreAllMocks();
  });

  it("shows the mode SQL detection picked", async () => {
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    wrapper.vm.searchObj.meta.sqlMode = false;
    await flushPromises();
    const sql = () => wrapper!.get('[data-test="logs-search-bar-query-mode-sql"]');
    expect(sql().attributes("data-state")).toBe("off");

    wrapper.vm.searchObj.meta.sqlMode = true;
    await flushPromises();
    expect(sql().attributes("data-state")).toBe("on");
  });

  it("turns SQL on from the tray", async () => {
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    wrapper.vm.searchObj.meta.sqlMode = false;
    await flushPromises();

    await wrapper.vm.setQueryMode("sql");
    expect(wrapper.vm.searchObj.meta.sqlMode).toBe(true);
  });

  it("keeps the WHERE clause as the filter when leaving SQL", async () => {
    wrapper = mountSearchBar();
    const { searchObj } = wrapper.vm;
    searchObj.meta.logsVisualizeToggle = "logs";
    searchObj.meta.sqlMode = true;
    searchObj.data.query = `SELECT service, count(*) FROM "app_logs" WHERE level = 'error' GROUP BY service`;
    await flushPromises();

    await wrapper.vm.setQueryMode("filter");

    expect(searchObj.meta.sqlMode).toBe(false);
    expect(searchObj.data.query).toBe("level = 'error'");
  });

  it("folds the tray into ⋯ when the toolbar is too narrow for it", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 200,
    } as DOMRect);
    wrapper = mount(SearchBar, {
      global: { provide: { store }, plugins: [i18n, router], stubs: { QueryEditor: true } },
    });
    await flushPromises();

    expect(wrapper.vm.queryModeInMenu).toBe(true);
    expect(wrapper.find('[data-test="logs-search-bar-query-mode"]').exists()).toBe(false);
  });

  it("gives Search back the typed query after Visualize rewrote the editor", async () => {
    wrapper = mountSearchBar();
    const { searchObj } = wrapper.vm;
    searchObj.meta.logsVisualizeToggle = "logs";
    searchObj.meta.sqlMode = true;
    searchObj.data.query = 'SELECT service, count(*) FROM "app_logs" GROUP BY service';
    await flushPromises();

    await wrapper.vm.onLogsVisualizeToggleUpdate("build");
    searchObj.data.query =
      'SELECT service as "service", count(_timestamp) as "count" FROM "app_logs"';
    await wrapper.vm.onLogsVisualizeToggleUpdate("logs");

    expect(searchObj.data.query).toBe('SELECT service, count(*) FROM "app_logs" GROUP BY service');
    expect(searchObj.meta.sqlMode).toBe(true);
  });

  it("disables Run with a reason until a stream is picked", async () => {
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    wrapper.vm.searchObj.data.stream.selectedStream = [];
    await flushPromises();
    expect(wrapper.vm.noStreamReason).toBe("Pick a stream first");

    wrapper.vm.searchObj.data.stream.selectedStream = ["app_logs"];
    await flushPromises();
    expect(wrapper.vm.noStreamReason).toBeNull();
  });

  it("disables SQL in Drill down and says why", async () => {
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.meta.sqlMode = false;
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "drilldown";
    await flushPromises();

    expect(wrapper.vm.sqlModeReason).toBe("Drill down is not available in SQL mode");
    await wrapper.vm.setQueryMode("sql");
    expect(wrapper.vm.searchObj.meta.sqlMode).toBe(false);
  });
});
