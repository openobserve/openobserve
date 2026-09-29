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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import config from "@/aws-exports";
import SearchBar from "@/plugins/logs/SearchBar.vue";

/**
 * Regression coverage for GH #14488: "Refresh Cache & Run Query" must be
 * visible on the Logs tab independent of auto_query_enabled (which only
 * gates Live Mode) and independent of enterprise build, matching the
 * Visualize tab's existing unconditional visibility.
 */
describe("SearchBar — Refresh Cache & Run Query dropdown visibility (#14488)", () => {
  let wrapper: VueWrapper<any> | undefined;
  const originalIsEnterprise = config.isEnterprise;

  // Real ODropdown/ODropdownItem render their content through a Reka UI
  // portal that only mounts while open; stubbing renders the slot content
  // inline so visibility can be asserted without simulating a click.
  const dropdownStubs = {
    ODropdown: {
      name: "ODropdown",
      template: '<div class="o-dropdown-stub"><slot name="trigger" /><slot /></div>',
    },
    ODropdownItem: {
      name: "ODropdownItem",
      template:
        '<div class="o-dropdown-item-stub" v-bind="$attrs" @click="$emit(\'select\')"><slot name="icon-left" /><slot /></div>',
      emits: ["select"],
    },
    ODropdownSeparator: {
      name: "ODropdownSeparator",
      template: '<div class="o-dropdown-separator-stub" />',
    },
  };

  const mountSearchBar = () =>
    mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true, ...dropdownStubs },
      },
    });

  const dropdownItemByTestId = (testId: string) =>
    wrapper
      ?.findAllComponents({ name: "ODropdownItem" })
      .find((c) => c.attributes("data-test") === testId);

  const refreshItem = () => dropdownItemByTestId("logs-search-bar-refresh-btn");
  const liveModeItem = () => dropdownItemByTestId("logs-search-bar-live-mode-toggle-btn");

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    (config as any).isEnterprise = originalIsEnterprise;
    store.state.zoConfig.auto_query_enabled = false;
    vi.clearAllMocks();
  });

  it.each([
    ["auto_query_enabled=false, OSS build", false, "false"],
    ["auto_query_enabled=false, enterprise build", false, "true"],
    ["auto_query_enabled=true, OSS build", true, "false"],
    ["auto_query_enabled=true, enterprise build", true, "true"],
  ])(
    "shows the Refresh Cache & Run Query dropdown on the Logs tab (%s)",
    async (_label, autoQueryEnabled, isEnterprise) => {
      store.state.zoConfig.auto_query_enabled = autoQueryEnabled;
      (config as any).isEnterprise = isEnterprise;
      wrapper = mountSearchBar();
      wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
      await nextTick();

      expect(wrapper.findComponent({ name: "ODropdown" }).exists()).toBe(true);
      expect(refreshItem()).toBeTruthy();
    },
  );

  it("hides the Live Mode item when auto_query_enabled is false, even in an enterprise build", async () => {
    store.state.zoConfig.auto_query_enabled = false;
    (config as any).isEnterprise = "true";
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    await nextTick();

    expect(refreshItem()).toBeTruthy();
    expect(liveModeItem()).toBeFalsy();
  });

  it("shows the Live Mode item when auto_query_enabled is true, even in an OSS build", async () => {
    store.state.zoConfig.auto_query_enabled = true;
    (config as any).isEnterprise = "false";
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    await nextTick();

    expect(refreshItem()).toBeTruthy();
    expect(liveModeItem()).toBeTruthy();
  });

  it("shows Refresh Cache & Run Query identically on the Logs tab and the Visualize tab", async () => {
    store.state.zoConfig.auto_query_enabled = false;
    (config as any).isEnterprise = "false";
    wrapper = mountSearchBar();

    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    await nextTick();
    const visibleOnLogsTab = !!refreshItem();

    wrapper.vm.searchObj.meta.logsVisualizeToggle = "visualize";
    await nextTick();
    const visibleOnVisualizeTab = !!refreshItem();

    expect(visibleOnLogsTab).toBe(true);
    expect(visibleOnVisualizeTab).toBe(true);
  });
});
