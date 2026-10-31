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

const UNPREFIXED_HORIZONTAL_MARGIN = /^-?m[xse]?-|^-?m[lr]-/;

describe("SearchBar — toolbar controls are spaced only by the row gap", () => {
  let wrapper: VueWrapper<any> | undefined;
  const { isPinned, togglePin } = useToolbarPins();
  const pinnedByTest: ToolbarPinKey[] = [];

  beforeEach(() => {
    resetLogsAutoRunForTests(store);
    for (const key of [
      "histogram",
      "sqlMode",
      "quickMode",
      "savedViews",
      "syntaxGuide",
    ] as ToolbarPinKey[]) {
      if (!isPinned(key)) {
        togglePin(key);
        pinnedByTest.push(key);
      }
    }
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return { width: this.classList.contains("border-b-card-glass-border") ? 1600 : 0 } as DOMRect;
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    while (pinnedByTest.length) togglePin(pinnedByTest.pop()!);
    vi.restoreAllMocks();
  });

  const marginClassesOf = (el: Element) =>
    [...el.classList].filter((c) => UNPREFIXED_HORIZONTAL_MARGIN.test(c));

  it("adds no horizontal margin on top of the gap-1 between adjacent controls", async () => {
    wrapper = mount(SearchBar, {
      attachTo: document.body,
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true },
      },
    });
    await flushPromises();

    const left = wrapper.vm.$refs.toolbarLeftRef as HTMLElement;
    const collapsible = left.firstElementChild as HTMLElement;
    expect(left.classList).toContain("gap-1");
    expect(collapsible.classList).toContain("gap-1");

    const more = wrapper.get('[data-test="logs-search-bar-utilities-menu-btn"]');
    expect(marginClassesOf(more.element)).toEqual([]);
    expect(more.classes()).toContain("max-md:ms-auto");

    const controls = [...collapsible.children, ...[...left.children].slice(1)];
    for (const dataTest of [
      "logs-logs-toggle",
      "logs-search-bar-reset-filters-btn",
      "logs-search-bar-histogram-btn",
      "logs-search-bar-sql-mode-pinned-btn",
      "logs-search-bar-quick-mode-pinned-btn",
      "logs-search-bar-saved-views-pinned",
    ]) {
      expect(
        controls.some(
          (c) =>
            c.querySelector(`[data-test="${dataTest}"]`) || c.matches(`[data-test="${dataTest}"]`),
        ),
      ).toBe(true);
    }
    expect(controls.length).toBeGreaterThanOrEqual(8);
    for (const control of controls) {
      expect(marginClassesOf(control), control.outerHTML.slice(0, 120)).toEqual([]);
    }
  });
});
