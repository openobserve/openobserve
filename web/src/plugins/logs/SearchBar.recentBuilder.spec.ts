// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
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
import router from "@/test/unit/helpers/router";

const api = vi.hoisted(() => ({ list: vi.fn(), count: vi.fn(), record: vi.fn() }));
vi.mock("@/services/query_history", () => ({ default: api }));

import { queryClient } from "@/composables/query/queryClient";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import SqlFilterBuilder from "@/components/filterBar/SqlFilterBuilder.vue";

const DT = "logs-search-bar-filter-builder-bar";
const entry = {
  id: "a",
  source: "logs",
  streams: ["default"],
  query: "level = 'error'",
  status: "ok",
  starred: false,
  context: {},
  updated_at: Date.now() * 1000,
  created_at: Date.now() * 1000,
  run_count: 1,
};

const row = (key: string) =>
  document.body.querySelector<HTMLElement>(`[data-test="${DT}-suggest-item-${key}"]`);
const caret = () => document.body.querySelector<HTMLInputElement>(`[data-test="${DT}-input"]`)!;

describe("logs recent searches with the filter builder on", () => {
  let wrapper: VueWrapper | null = null;

  const mountBar = async () => {
    wrapper = mount(SearchBar, {
      attachTo: document.body,
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true, RecentSearchesFocusDropdown: true },
      },
    });
    const vm = wrapper.vm as unknown as {
      searchObj: { data: { query: string; editorValue: string } };
    };
    vm.searchObj.data.query = "";
    vm.searchObj.data.editorValue = "";
    await flushPromises();
    return vm;
  };

  const openPicker = async () => {
    caret().click();
    await flushPromises();
    await vi.waitFor(() => expect(row("extra-recent-a")).not.toBeNull());
  };

  beforeEach(() => {
    store.state.zoConfig.query_history_enabled = true;
    queryClient.clear();
    api.list.mockResolvedValue({ data: [entry] });
    api.count.mockResolvedValue({ data: { count: 0 } });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    delete store.state.zoConfig.query_history_enabled;
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("lists recent searches above the fields when the empty bar opens", async () => {
    await mountBar();
    expect(wrapper!.findComponent(SqlFilterBuilder).exists()).toBe(true);
    await openPicker();
    expect(row("extra-recent-a")!.textContent).toContain("level = 'error'");
    expect(
      document.body.querySelector(`[data-test="${DT}-suggest-section"]`)!.textContent,
    ).toContain("Recent searches");
    expect(row("extra-recent-view-all")).not.toBeNull();
  });

  it("restores the picked row and closes the list", async () => {
    await mountBar();
    const push = vi.spyOn(router, "push");
    await openPicker();
    row("extra-recent-a")!.click();
    await flushPromises();
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ path: "/logs" }));
    expect(row("extra-recent-a")).toBeNull();
    push.mockRestore();
  });

  it("hides the section as soon as something is typed", async () => {
    await mountBar();
    await openPicker();
    caret().value = "l";
    caret().dispatchEvent(new Event("input"));
    await flushPromises();
    expect(row("extra-recent-a")).toBeNull();
  });

  it("asks nothing and shows nothing when history is off", async () => {
    delete store.state.zoConfig.query_history_enabled;
    await mountBar();
    caret().click();
    await flushPromises();
    expect(api.list).not.toHaveBeenCalled();
    expect(row("extra-recent-a")).toBeNull();
  });
});
