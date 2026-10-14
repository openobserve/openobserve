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
import { useLogsAutoRun, resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";
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
      attachTo: document.body,
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true },
      },
    });
  };

  const group = () => wrapper!.find('[data-test="logs-search-bar-saved-views-pinned"]');

  beforeEach(() => {
    resetLogsAutoRunForTests(store);
    if (!isPinned("savedViews")) togglePin("savedViews");
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    if (isPinned("savedViews")) togglePin("savedViews");
    vi.restoreAllMocks();
  });

  it("gives the list trigger the grouped xs size with an icon and a caret", async () => {
    wrapper = mountSearchBar(1600);
    await flushPromises();

    const trigger = group()
      .findAllComponents({ name: "OButton" })
      .find((b) => b.attributes("data-test") === "logs-search-bar-saved-views-pinned-list-btn")!;
    expect(trigger.props("size")).toBe("xs-grouped");
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

  it("is as tall as the xs toolbar buttons: a hairline border around 1.625rem children", async () => {
    wrapper = mountSearchBar(1600);
    await flushPromises();

    expect(group().classes()).toContain("border");
    expect(group().classes()).toContain("p-0");
    expect(
      group().find('[data-test="logs-search-bar-saved-views-pinned-list-btn"]').classes(),
    ).toContain("h-6.5");
    expect(
      group().find('[data-test="logs-search-bar-saved-views-pinned-create-btn"]').classes(),
    ).toContain("size-6.5");
    expect(wrapper!.find('[data-test="logs-search-bar-reset-filters-btn"]').classes()).toContain(
      "h-7",
    );
  });

  it("keeps the unavailable create action focusable with an inert click and reason", async () => {
    wrapper = mountSearchBar(1600);
    await flushPromises();
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    useLogsAutoRun().invalidateExecuted("search-around");
    await flushPromises();
    const button = group().get('[data-test="logs-search-bar-saved-views-pinned-create-btn"]');
    expect(button.attributes("disabled")).toBeUndefined();
    expect(button.attributes("aria-disabled")).toBe("true");
    expect(button.attributes("aria-label")).toBe(i18n.global.t("search.createSavedView"));
    const reason = button.get(".sr-only");
    expect(button.attributes("aria-describedby")).toBe(reason.attributes("id"));
    expect(reason.text()).toBe(i18n.global.t("search.autoRunSearchAroundActive"));
    expect(reason.attributes("aria-hidden")).toBe("true");
    (button.element as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(button.element);
    const dispatch = vi.spyOn(store, "dispatch");
    await button.trigger("click");
    expect(dispatch).not.toHaveBeenCalledWith("setSavedViewDialog", true);
    expect(
      group()
        .findAllComponents({ name: "OButton" })
        .find(
          (control) =>
            control.attributes("data-test") === "logs-search-bar-saved-views-pinned-create-btn",
        )!
        .emitted("click"),
    ).toBeUndefined();
    resetLogsAutoRunForTests(store);
  });

  it("names the icon-only update action independently of its unavailable reason", async () => {
    wrapper = mountSearchBar(1600);
    await flushPromises();
    wrapper.vm.searchObj.data.savedViews = [{ view_id: "named", view_name: "Named view" }];
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    useLogsAutoRun().invalidateExecuted("search-around");
    await flushPromises();
    await group().get('[data-test="logs-search-bar-saved-views-pinned-list-btn"]').trigger("click");
    await flushPromises();
    const button = document.querySelector(
      '[data-test="logs-search-bar-saved-views-menu-update-Named view"]',
    )!;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe(
      i18n.global.t("search.updateSavedViewWithCurrent"),
    );
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("title")).toBeNull();
    const reason = document.getElementById(button.getAttribute("aria-describedby")!)!;
    expect(reason.textContent).toBe(i18n.global.t("search.autoRunSearchAroundActive"));
    expect(reason.getAttribute("aria-hidden")).toBe("true");
    resetLogsAutoRunForTests(store);
  });

  it("does not repeat the available update action name as its description", async () => {
    wrapper = mountSearchBar(1600);
    await flushPromises();
    wrapper.vm.searchObj.data.savedViews = [{ view_id: "named", view_name: "Named view" }];
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    await flushPromises();
    await group().get('[data-test="logs-search-bar-saved-views-pinned-list-btn"]').trigger("click");
    await flushPromises();
    const button = document.querySelector(
      '[data-test="logs-search-bar-saved-views-menu-update-Named view"]',
    )!;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe(
      i18n.global.t("search.updateSavedViewWithCurrent"),
    );
    expect(button.getAttribute("aria-disabled")).toBeNull();
    expect(button.getAttribute("disabled")).toBeNull();
    expect(button.getAttribute("title")).toBeNull();
    expect(button.getAttribute("aria-describedby")).toBeNull();
  });

  it.each(["Enter", " "])("blocks unavailable Update activation with %s", async (key) => {
    wrapper = mountSearchBar(1600);
    await flushPromises();
    wrapper.vm.searchObj.data.savedViews = [{ view_id: "named", view_name: "Named view" }];
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    useLogsAutoRun().invalidateExecuted("search-around");
    await flushPromises();
    const apply = vi.spyOn(wrapper.vm, "applySavedView").mockImplementation(() => {});
    const update = vi.spyOn(wrapper.vm, "quickUpdateSavedView").mockImplementation(() => {});
    await group().get('[data-test="logs-search-bar-saved-views-pinned-list-btn"]').trigger("click");
    await flushPromises();
    const button = document.querySelector(
      '[data-test="logs-search-bar-saved-views-menu-update-Named view"]',
    )!;
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    await flushPromises();
    expect(event.defaultPrevented).toBe(true);
    expect(apply).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("updates with Enter on available Update and applies with Enter on the row", async () => {
    wrapper = mountSearchBar(1600);
    await flushPromises();
    const view = { view_id: "named", view_name: "Named view" };
    wrapper.vm.searchObj.data.savedViews = [view];
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    await flushPromises();
    const apply = vi.spyOn(wrapper.vm, "applySavedView").mockImplementation(() => {});
    const update = vi.spyOn(wrapper.vm, "quickUpdateSavedView").mockImplementation(() => {});
    await group().get('[data-test="logs-search-bar-saved-views-pinned-list-btn"]').trigger("click");
    await flushPromises();
    const button = document.querySelector(
      '[data-test="logs-search-bar-saved-views-menu-update-Named view"]',
    )!;
    expect(button.getAttribute("aria-disabled")).toBeNull();
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    await flushPromises();
    expect(update).toHaveBeenCalledExactlyOnceWith(view);
    expect(apply).not.toHaveBeenCalled();
    const row = document.querySelector(
      '[data-test="logs-search-bar-saved-views-menu-apply-Named view"]',
    )!;
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    await flushPromises();
    expect(apply).toHaveBeenCalledExactlyOnceWith(view);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("gives the visualize toggle an explicit translated name", async () => {
    const timechartEnabled = store.state.zoConfig.timechart_enabled;
    store.state.zoConfig.timechart_enabled = true;
    wrapper = mountSearchBar(1600);
    await flushPromises();
    const toggle = wrapper.get('[data-test="logs-visualize-toggle"]');
    expect(toggle.attributes("aria-label")).toBe(i18n.global.t("search.visualize"));
    store.state.zoConfig.timechart_enabled = timechartEnabled;
  });

  it("moves the group into the More menu when the toolbar has no room", async () => {
    wrapper = mountSearchBar();
    await flushPromises();

    expect(group().exists()).toBe(false);
  });
});
