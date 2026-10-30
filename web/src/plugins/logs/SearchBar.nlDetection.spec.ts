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

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import SearchBar from "@/plugins/logs/SearchBar.vue";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

// Logs opens the AI bar only from its explicit toggle, so detected natural language must not reshape Run.
describe("SearchBar — Run button ignores natural-language detection (#15049)", () => {
  let wrapper: VueWrapper<any> | undefined;
  const originalAutoQuery = store.state.zoConfig.auto_query_enabled;

  const stubs = {
    UnifiedQueryEditor: {
      name: "UnifiedQueryEditor",
      template: '<div class="query-editor-stub" />',
      emits: ["nlp-detected"],
    },
    ODropdown: {
      name: "ODropdown",
      template: '<div class="o-dropdown-stub"><slot name="trigger" /><slot /></div>',
    },
    ODropdownItem: {
      name: "ODropdownItem",
      template: '<div class="o-dropdown-item-stub" v-bind="$attrs"><slot /></div>',
    },
    ODropdownSeparator: { name: "ODropdownSeparator", template: "<div />" },
  };

  const dropdownItem = (testId: string) =>
    wrapper
      ?.findAllComponents({ name: "ODropdownItem" })
      .find((c) => c.attributes("data-test") === testId);

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    store.state.zoConfig.auto_query_enabled = originalAutoQuery;
  });

  it("keeps Run query and its dropdown items after the editor reports natural language", async () => {
    store.state.zoConfig.auto_query_enabled = true;
    await router.replace({ name: "logs" });
    wrapper = mount(SearchBar, {
      global: { provide: { store }, plugins: [i18n, router], stubs },
    });
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    wrapper.vm.searchObj.meta.nlpMode = false;
    await nextTick();

    wrapper.findComponent({ name: "UnifiedQueryEditor" }).vm.$emit("nlp-detected", true);
    await nextTick();

    const runButton = wrapper.find('button[data-test="logs-search-bar-refresh-btn"]');
    expect(runButton.exists()).toBe(true);
    expect(runButton.text()).toBe("Run query");
    expect(runButton.attributes("title")).toBe("Run query");
    expect(dropdownItem("logs-search-bar-refresh-btn")).toBeTruthy();
    expect(dropdownItem("logs-search-bar-live-mode-toggle-btn")).toBeTruthy();
  });
});
