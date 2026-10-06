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
import { useToolbarPins } from "@/composables/useToolbarPins";

// A light in-memory router: the app router lazy-loads real pages on navigation.
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

describe("SearchBar — pinned saved views", () => {
  let wrapper: VueWrapper<any> | undefined;
  const { isPinned, togglePin } = useToolbarPins();

  // jsdom reports zero widths, so every pinned item would fall back into the More menu.
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

  const group = () => wrapper!.find('[data-test="logs-search-bar-saved-views-pinned"]');

  beforeEach(() => {
    if (!isPinned("savedViews")) togglePin("savedViews");
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    if (isPinned("savedViews")) togglePin("savedViews");
    vi.restoreAllMocks();
  });

  it("gives the list trigger the padded sm-toolbar size with an icon and a caret", async () => {
    wrapper = mountSearchBar(1600);
    await flushPromises();

    const trigger = group()
      .findAllComponents({ name: "OButton" })
      .find((b) => b.attributes("data-test") === "logs-search-bar-saved-views-pinned-list-btn")!;
    expect(trigger.props("size")).toBe("sm-toolbar");
    const icons = trigger.findAllComponents({ name: "OIcon" }).map((c) => c.props("name"));
    expect(icons).toEqual(["saved-search", "arrow-drop-down"]);
  });

  it("divides the list trigger from the save button with a vertical separator", async () => {
    wrapper = mountSearchBar(1600);
    await flushPromises();

    expect(group().exists()).toBe(true);
    const separator = group().findComponent({ name: "OSeparator" });
    expect(separator.exists()).toBe(true);
    expect(separator.props("vertical")).toBe(true);
    expect(
      group().find('[data-test="logs-search-bar-saved-views-pinned-create-btn"]').exists(),
    ).toBe(true);
  });

  it("moves the group into the More menu when the toolbar has no room", async () => {
    wrapper = mountSearchBar();
    await flushPromises();

    expect(group().exists()).toBe(false);
  });
});
