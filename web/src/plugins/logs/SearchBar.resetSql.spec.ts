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
import { resetLogsAutoRunForTests, useLogsAutoRun } from "@/composables/useLogs/logsAutoRun";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

describe("SearchBar - Reset in SQL mode", () => {
  let wrapper: VueWrapper<any> | undefined;

  const resetWith = async (sql: string) => {
    wrapper = mount(SearchBar, {
      global: { provide: { store }, plugins: [i18n, router], stubs: { QueryEditor: true } },
    });
    const { searchObj } = wrapper.vm;
    searchObj.meta.sqlMode = true;
    searchObj.data.stream.selectedStream = ["app_logs"];
    searchObj.data.query = sql;
    searchObj.data.editorValue = sql;
    await flushPromises();
    wrapper.vm.resetFilters();
    await flushPromises();
    return searchObj.data.query as string;
  };

  beforeEach(() => resetLogsAutoRunForTests());

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.restoreAllMocks();
  });

  it("leaves a query with no WHERE or LIMIT exactly as the user wrote it", async () => {
    const sql = 'SELECT count(*) AS cnt FROM "app_logs"';
    expect(await resetWith(sql)).toBe(sql);
  });

  it("still clears the WHERE and LIMIT of a query that has them", async () => {
    const query = await resetWith(
      "SELECT level FROM \"app_logs\" WHERE level = 'error' ORDER BY level LIMIT 5",
    );
    expect(query).not.toMatch(/where/i);
    expect(query).not.toMatch(/limit/i);
  });

  it("still runs the search straight away when a query has nothing to clear and stream selection does not auto-run", async () => {
    const saved = store.state.zoConfig.query_on_stream_selection;
    store.state.zoConfig.query_on_stream_selection = false;
    const requestRun = vi.spyOn(useLogsAutoRun().engine, "requestRun");
    const sql = 'SELECT count(*) AS cnt FROM "app_logs"';
    expect(await resetWith(sql)).toBe(sql);
    expect(requestRun.mock.calls.some(([reason]) => reason === "run")).toBe(true);
    store.state.zoConfig.query_on_stream_selection = saved;
  });
});
