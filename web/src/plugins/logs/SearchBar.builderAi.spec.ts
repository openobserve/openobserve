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
const dt = (id: string) => `[data-test="${id}"]`;

describe("SearchBar — Ask AI while the filter builder shows", () => {
  let wrapper: VueWrapper<any> | undefined;

  beforeEach(() => {
    resetLogsAutoRunForTests(store);
    localStorage.setItem("o2.logs.queryInput", "builder");
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

  it("offers the AI button beside the builder and hands the click to the query editor", async () => {
    wrapper = mountSearchBar();
    await flushPromises();
    expect(wrapper.find(dt("logs-search-bar-filter-builder")).exists()).toBe(true);
    const openAiMode = vi.fn();
    wrapper.vm.queryEditorRef = { openAiMode };
    wrapper.vm.searchObj.data.stream.selectedStream = ["app_logs"];
    await flushPromises();
    await wrapper.find(dt("logs-search-bar-filter-builder-ai-btn")).trigger("click");
    expect(openAiMode).toHaveBeenCalledTimes(1);
  });

  it("gives AI mode the query editor and brings the builder back when it closes", async () => {
    wrapper = mountSearchBar();
    await flushPromises();
    wrapper.vm.searchObj.meta.nlpMode = true;
    await flushPromises();
    expect(wrapper.find(dt("logs-search-bar-filter-builder")).exists()).toBe(false);
    wrapper.vm.searchObj.meta.nlpMode = false;
    await flushPromises();
    expect(wrapper.find(dt("logs-search-bar-filter-builder")).exists()).toBe(true);
  });
});
