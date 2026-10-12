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
import config from "@/aws-exports";
import SearchBar from "@/plugins/logs/SearchBar.vue";

// Spy on the logs search entry point SearchBar takes from useLogs.
const handleRunQuery = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useLogs", async () => {
  const actual =
    await vi.importActual<typeof import("@/composables/useLogs")>("@/composables/useLogs");
  return {
    ...actual,
    default: (...args: Parameters<typeof actual.default>) => ({
      ...actual.default(...args),
      handleRunQuery,
    }),
  };
});

// A light in-memory router: the app router lazy-loads real pages on navigation.
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

describe("SearchBar — Drill down mode toggle", () => {
  let wrapper: VueWrapper<any> | undefined;
  const originalIsEnterprise = config.isEnterprise;

  // jsdom reports zero widths, which collapses the toggle group into the narrow-width dropdown.
  const mountSearchBar = (toolbarWidth = 0) => {
    if (toolbarWidth) {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        const isToolbarBar = this.classList.contains("border-b-card-glass-border");
        return { width: isToolbarBar ? toolbarWidth : 0 } as DOMRect;
      });
    }
    return mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true },
      },
    });
  };

  const toggleTestIds = () =>
    wrapper!
      .findAll('[data-test$="-toggle"]')
      .map((el) => el.attributes("data-test"))
      .filter((id) => /^logs-(logs|visualize|build|drilldown|patterns)-toggle$/.test(id ?? ""));

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    (config as any).isEnterprise = originalIsEnterprise;
    vi.restoreAllMocks();
  });

  it("renders Drill down right after Visualize (build) and before Patterns", async () => {
    (config as any).isEnterprise = "true";
    wrapper = mountSearchBar(1600);
    await flushPromises();

    const ids = toggleTestIds();
    expect(ids).toContain("logs-drilldown-toggle");
    expect(ids.indexOf("logs-drilldown-toggle")).toBe(ids.indexOf("logs-build-toggle") + 1);
    expect(ids.indexOf("logs-patterns-toggle")).toBe(ids.indexOf("logs-drilldown-toggle") + 1);
  });

  it("labels the toggle 'Drill down'", async () => {
    wrapper = mountSearchBar(1600);
    await flushPromises();

    expect(wrapper.find('[data-test="logs-drilldown-toggle"]').text()).toContain("Drill down");
  });

  it("lists Drill down in the narrow-width view-mode dropdown, disabled in SQL mode", async () => {
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.meta.sqlMode = false;
    await flushPromises();

    const option = () =>
      wrapper!.vm.toggleViewOptions.find((o: { value: string }) => o.value === "drilldown");
    expect(option()).toMatchObject({ label: "Drill down", disabled: false });

    wrapper.vm.searchObj.meta.sqlMode = true;
    await flushPromises();
    expect(option().disabled).toBe(true);
  });

  it("switches to drill down mode on click and records it in the URL", async () => {
    await router.replace({ name: "logs", query: {} });
    expect(router.currentRoute.value.query.logs_visualize_toggle).toBeUndefined();
    wrapper = mountSearchBar(1600);
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    wrapper.vm.searchObj.meta.sqlMode = false;
    wrapper.vm.searchObj.data.queryResults = { hits: [{ _timestamp: 1 }] };
    await flushPromises();

    await wrapper.find('[data-test="logs-drilldown-toggle"]').trigger("click");
    await flushPromises();

    expect(wrapper.vm.searchObj.meta.logsVisualizeToggle).toBe("drilldown");
    expect(router.currentRoute.value.query.logs_visualize_toggle).toBe("drilldown");
  });

  it("extracts patterns when switching from drill down to patterns", async () => {
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "drilldown";
    await flushPromises();

    await wrapper.vm.onLogsVisualizeToggleUpdate("patterns");

    expect(wrapper.emitted("extractPatterns")).toBeTruthy();
  });

  it("runs the logs search on Run query instead of delegating to the page", async () => {
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "drilldown";
    await flushPromises();

    wrapper.vm.handleRunQueryFn();

    expect(handleRunQuery).toHaveBeenCalledWith(false);
    expect(wrapper.emitted("handleRunQueryFn")).toBeFalsy();
  });

  it("re-runs the logs search when the date changes in drill down", async () => {
    store.state.zoConfig.query_on_stream_selection = false;
    wrapper = mountSearchBar();
    const { searchObj } = wrapper.vm;
    searchObj.meta.logsVisualizeToggle = "drilldown";
    searchObj.data.stream.selectedStream = ["app_logs"];
    searchObj.loading = false;
    searchObj.runQuery = false;
    await flushPromises();

    await wrapper.vm.updateDateTime({
      valueType: "relative",
      relativeTimePeriod: "1h",
      startTime: 1_000,
      endTime: 2_000,
      userChangedValue: true,
    });

    expect(searchObj.runQuery).toBe(true);
    expect(wrapper.emitted("searchdata")).toBeTruthy();
  });
});
