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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createMemoryHistory } from "vue-router";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import { resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";
import { useToolbarPins, type ToolbarPinKey } from "@/composables/useToolbarPins";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

// The view-mode OToggleGroup is 34px tall (28px sm items + 2px track padding each side + 1px border each side).
const TOGGLE_GROUP_HEIGHT_CLASS = "h-[2.125rem]!";

describe("SearchBar — toolbar controls match the view-mode toggle height", () => {
  let wrapper: VueWrapper<any> | undefined;
  const { isPinned, togglePin } = useToolbarPins();
  const pinnedByTest: ToolbarPinKey[] = [];

  // jsdom reports zero widths, which collapses the toggle group into its narrow dropdown.
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
      attachTo: document.body,
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true },
      },
    });
  };

  const expectToolbarHeight = (dataTest: string) => {
    const button = wrapper!.get(`[data-test="${dataTest}"]`);
    expect(button.classes()).toContain(TOGGLE_GROUP_HEIGHT_CLASS);
    expect(button.classes()).toContain("text-xs");
  };

  beforeEach(() => {
    resetLogsAutoRunForTests(store);
    for (const key of ["histogram", "sqlMode", "quickMode"] as ToolbarPinKey[]) {
      if (!isPinned(key)) {
        togglePin(key);
        pinnedByTest.push(key);
      }
    }
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    while (pinnedByTest.length) togglePin(pinnedByTest.pop()!);
    vi.restoreAllMocks();
  });

  it("gives Reset, the pinned switches and More the 34px toggle-group height at desktop width", async () => {
    wrapper = mountSearchBar(1600);
    await flushPromises();

    expect(wrapper.find('[data-test="logs-logs-toggle"]').exists()).toBe(true);
    for (const dataTest of [
      "logs-search-bar-reset-filters-btn",
      "logs-search-bar-histogram-btn",
      "logs-search-bar-sql-mode-pinned-btn",
      "logs-search-bar-quick-mode-pinned-btn",
      "logs-search-bar-utilities-menu-btn",
    ]) {
      expectToolbarHeight(dataTest);
    }
  });

  it("gives the narrow-width view-mode dropdown button the same 34px height", async () => {
    wrapper = mountSearchBar();
    await flushPromises();

    expect(wrapper.find('[data-test="logs-logs-toggle"]').exists()).toBe(false);
    expectToolbarHeight("logs-view-mode-dropdown-btn");
    expectToolbarHeight("logs-search-bar-utilities-menu-btn");
  });

  it("raises every right-hand control to the same 34px row height", async () => {
    const innerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true });
    if (!isPinned("functionEditor")) {
      togglePin("functionEditor");
      pinnedByTest.push("functionEditor");
    }
    try {
      wrapper = mountSearchBar(1600);
      await flushPromises();
      wrapper.vm.searchObj.meta.showTransformEditor = true;
      await flushPromises();

      const classesOf = (dataTest: string) => wrapper!.get(`[data-test="${dataTest}"]`).classes();
      for (const dataTest of [
        "logs-search-bar-more-options-btn",
        "logs-search-bar-share-link-btn",
      ]) {
        expect(classesOf(dataTest)).toContain("size-[2.125rem]!");
      }
      for (const dataTest of [
        "logs-search-bar-function-editor-pinned-btn",
        "logs-search-bar-date-time-dropdown",
        "logs-search-bar-refresh-btn",
        "logs-search-bar-refresh-cache-dropdown-trigger",
      ]) {
        expect(classesOf(dataTest)).toContain(TOGGLE_GROUP_HEIGHT_CLASS);
      }
      const runButton = wrapper.get('[data-test="logs-search-bar-refresh-btn"]').element;
      expect(runButton.nextElementSibling!.classList).toContain(TOGGLE_GROUP_HEIGHT_CLASS);
      const interval = wrapper.get('[data-test="logs-search-bar-refresh-interval-btn"]').element;
      expect(interval.parentElement!.classList).toContain("*:size-[2.125rem]!");
      // A 1px group border around 2rem buttons makes the function selector 34px.
      for (const dataTest of [
        "logs-search-bar-function-dropdown",
        "logs-search-bar-save-function-btn",
      ]) {
        expect(classesOf(dataTest)).toContain("size-8!");
      }
    } finally {
      Object.defineProperty(window, "innerWidth", { value: innerWidth, configurable: true });
    }
  });
});
