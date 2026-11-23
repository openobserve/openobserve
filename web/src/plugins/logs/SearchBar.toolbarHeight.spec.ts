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

// Every toolbar button takes the md control height token (32px).
const TOOLBAR_BUTTON_HEIGHT_CLASS = "h-control-md";

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
        const isToolbarBar =
          this.classList.contains("border-border-default") &&
          this.classList.contains("overflow-hidden");
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
    expect(button.classes()).toContain(TOOLBAR_BUTTON_HEIGHT_CLASS);
    expect(button.classes()).toContain("text-compact");
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

  it("gives Reset, the pinned switches and More the md control height at desktop width", async () => {
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

  it("gives the narrow-width view-mode dropdown button the same md control height", async () => {
    wrapper = mountSearchBar();
    await flushPromises();

    expect(wrapper.find('[data-test="logs-logs-toggle"]').exists()).toBe(false);
    expectToolbarHeight("logs-view-mode-dropdown-btn");
    expectToolbarHeight("logs-search-bar-utilities-menu-btn");
  });

  it("raises every right-hand control to the same md control height", async () => {
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
      expect(classesOf("logs-search-bar-more-options-btn")).toContain("size-control-md");
      expect(classesOf("logs-search-bar-share-link-btn")).toContain("size-control-md");
      for (const dataTest of [
        "logs-search-bar-function-editor-pinned-btn",
        "logs-search-bar-refresh-btn",
      ]) {
        expect(classesOf(dataTest)).toContain(TOOLBAR_BUTTON_HEIGHT_CLASS);
      }
      expect(classesOf("logs-search-bar-refresh-cache-dropdown-trigger")).toContain(
        "size-control-md",
      );
      // The range group owns its control height; a call-site height override is what must not appear.
      expect(
        classesOf("logs-search-bar-date-time-dropdown").filter(
          (c) => /(^|:)!?h-/.test(c) && !/(^|:)h-control-/.test(c),
        ),
      ).toEqual([]);
      expect(
        wrapper!
          .get('[data-test="logs-search-bar-date-time-dropdown"] [data-test="date-time-btn"]')
          .classes(),
      ).toContain("h-control-md");
      const runButton = wrapper.get('[data-test="logs-search-bar-refresh-btn"]').element;
      expect(runButton.nextElementSibling!.classList).toContain("h-8.5!");
      expect(classesOf("logs-search-bar-refresh-interval-btn")).toContain("size-control-md");
      // The bordered function box is the md control, so its buttons are sm to fit inside the border.
      expect(wrapper.get(".function-selector").classes()).toContain(TOOLBAR_BUTTON_HEIGHT_CLASS);
      for (const dataTest of [
        "logs-search-bar-function-dropdown",
        "logs-search-bar-save-function-btn",
      ]) {
        expect(classesOf(dataTest)).toContain("size-control-sm");
      }
    } finally {
      Object.defineProperty(window, "innerWidth", { value: innerWidth, configurable: true });
    }
  });
});
