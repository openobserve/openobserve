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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createMemoryHistory, createRouter } from "vue-router";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import { resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

describe("SearchBar — the query pane grows with the filter builder", () => {
  let wrapper: VueWrapper<any> | undefined;
  let builderHeight = 30;

  beforeEach(() => {
    resetLogsAutoRunForTests(store);
    localStorage.setItem("o2.logs.queryInput", "builder");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const builder = this.getAttribute("data-test") === "logs-search-bar-filter-builder";
      return { height: builder ? builderHeight : 0, width: 0 } as DOMRect;
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    localStorage.removeItem("o2.logs.queryInput");
    vi.restoreAllMocks();
  });

  const mountSearchBar = () =>
    mount(SearchBar, {
      attachTo: document.body,
      global: { provide: { store }, plugins: [i18n, router], stubs: { QueryEditor: true } },
    });

  it("reports no growth while the builder fits on one line", async () => {
    builderHeight = 30;
    wrapper = mountSearchBar();
    await flushPromises();
    expect(wrapper.emitted("filterBuilderGrowth")?.at(-1)).toEqual([0]);
  });

  it("reports the extra height of a wrapped builder, and null once the query editor is back", async () => {
    builderHeight = 84;
    wrapper = mountSearchBar();
    await flushPromises();
    expect(wrapper.emitted("filterBuilderGrowth")?.at(-1)).toEqual([54]);
    await wrapper.find('[data-test="logs-search-bar-filter-builder-toggle"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("filterBuilderGrowth")?.at(-1)).toEqual([null]);
  });
});
