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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ref } from "vue";
import MenuLink from "@/components/MenuLink.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createWebHistory } from "vue-router";

// The label's clamp measurement needs layout; drive the result directly.
const truncated = ref(false);
const updateTruncated = vi.fn();
vi.mock("@/lib/overlay/Tooltip/useIsTruncated", () => ({
  useIsTruncated: () => ({ isTruncated: truncated, update: updateTruncated }),
}));

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: { template: "<div>Home</div>" } },
    { path: "/logs", component: { template: "<div>Logs</div>" } },
  ],
});

// Set current route for the router
mockRouter.currentRoute.value = {
  path: "/logs",
  name: "logs",
  params: {},
  query: {},
  hash: "",
  fullPath: "/logs",
  matched: [],
  meta: {},
  redirectedFrom: undefined,
};

describe("MenuLink", async () => {
  let wrapper: any = null;
  beforeEach(() => {
    truncated.value = false;
    // render the component
    wrapper = mount(MenuLink, {
      props: {
        title: "Logs",
        caption: "",
        link: "#",
        icon: "",
        mini: false,
      },
      global: {
        plugins: [i18n, mockRouter],
        provide: {
          store,
        },
      },
    });
  });

  afterEach(() => {
    wrapper.unmount();
    document.body.innerHTML = "";
  });

  it("should mount MenuLink component", async () => {
    expect(wrapper).toBeTruthy();
  });

  it("should render item title", async () => {
    expect(wrapper.find('[data-test="menu-link-#-item"]').text()).toBe("Logs");
  });

  it("should handle mini prop correctly", async () => {
    await wrapper.setProps({ mini: true });
    expect(wrapper.props("mini")).toBe(true);
  });

  it("should call window.open after clicking on external url", async () => {
    const windowOpen = vi.spyOn(window, "open");
    await wrapper.setProps({ external: true });
    await wrapper.find('[data-test="menu-link-#-item"]').trigger("click");
    expect(windowOpen).toHaveBeenCalledTimes(1);
    expect(windowOpen).toBeCalledWith("#", "_blank");
    windowOpen.mockRestore();
  });

  it("should render icon when icon prop is provided", async () => {
    await wrapper.setProps({ icon: "home" });
    expect(wrapper.findComponent(OIcon).exists()).toBe(true);
  });

  it("should render with iconComponent when provided", async () => {
    const iconComponent = { template: "<div>Custom Icon</div>" };
    await wrapper.setProps({ iconComponent });
    expect(wrapper.vm.iconComponent).toBeDefined();
  });

  it("should have correct default props", () => {
    expect(wrapper.props("caption")).toBe("");
    expect(wrapper.props("link")).toBe("#");
    expect(wrapper.props("icon")).toBe("");
    expect(wrapper.props("mini")).toBe(false);
  });

  it("should expose openWebPage function from setup", () => {
    expect(typeof wrapper.vm.openWebPage).toBe("function");
  });

  it("should not open external link when external is false", async () => {
    const windowOpen = vi.spyOn(window, "open");
    await wrapper.setProps({ external: false });
    await wrapper.find('[data-test="menu-link-#-item"]').trigger("click");
    expect(windowOpen).not.toHaveBeenCalled();
    windowOpen.mockRestore();
  });

  it("forwards listeners and attrs to the tile element, not the tooltip", async () => {
    const onClick = vi.fn();
    const w = mount(MenuLink, {
      props: { title: "Logs", link: "/logs" },
      attrs: { onClick, "link-name": "logs", class: "extra" },
      global: { plugins: [i18n, mockRouter], provide: { store } },
    });
    const tile = w.find('[data-test="menu-link-/logs-item"]');
    expect(tile.attributes("link-name")).toBe("logs");
    expect(tile.classes()).toContain("extra");
    await tile.trigger("click");
    expect(onClick).toHaveBeenCalledTimes(1);
    w.unmount();
  });

  describe("accessible name and state (AC-9)", () => {
    it("marks the active tile with aria-current and a name without the current-page suffix", async () => {
      await mockRouter.push("/logs");
      const w = mount(MenuLink, {
        props: { title: "Logs", link: "/logs" },
        global: { plugins: [i18n, mockRouter], provide: { store } },
      });
      const tile = w.find('[data-test="menu-link-/logs-item"]');
      expect(tile.attributes("aria-current")).toBe("page");
      expect(tile.attributes("aria-label")).toBe("Logs");
      expect(tile.classes()).toContain("nav-menu-item--active");
      w.unmount();
    });

    it("exposes aria-haspopup=menu and aria-expanded on a link-mode group tile", async () => {
      const w = mount(MenuLink, {
        props: { title: "Data", link: "/streams", submenu: true, expanded: false },
        global: { plugins: [i18n, mockRouter], provide: { store } },
      });
      const tile = w.find('[data-test="menu-link-/streams-item"]');
      expect(tile.attributes("aria-haspopup")).toBe("menu");
      expect(tile.attributes("aria-expanded")).toBe("false");
      await w.setProps({ expanded: true });
      expect(tile.attributes("aria-expanded")).toBe("true");
      w.unmount();
    });

    it("keeps haspopup/expanded on a pure-group trigger", () => {
      const w = mount(MenuLink, {
        props: { title: "Group", link: "group-x", asTrigger: true, expanded: true },
        global: { plugins: [i18n, mockRouter], provide: { store } },
      });
      const tile = w.find('[data-test="menu-link-group-x-item"]');
      expect(tile.element.tagName).toBe("BUTTON");
      expect(tile.attributes("aria-haspopup")).toBe("menu");
      expect(tile.attributes("aria-expanded")).toBe("true");
      w.unmount();
    });

    it("leaves a plain link tile without haspopup", () => {
      expect(
        wrapper.find('[data-test="menu-link-#-item"]').attributes("aria-haspopup"),
      ).toBeUndefined();
    });
  });

  describe("direction-aware chevron and focus ring", () => {
    const mountGroup = (expanded: boolean) =>
      mount(MenuLink, {
        props: { title: "Group", link: "group-x", asTrigger: true, expanded },
        global: { plugins: [i18n, mockRouter], provide: { store } },
      });

    it("places the submenu chevron at the inline end so it faces the flyout in RTL", () => {
      const w = mountGroup(false);
      const chevron = w.find('[data-test="menu-link-group-x-item"] > span[aria-hidden="true"]');
      expect(chevron.classes()).toEqual(expect.arrayContaining(["end-1", "max-md:end-3"]));
      expect(chevron.classes()).not.toContain("right-1");
      expect(chevron.classes()).not.toContain("max-md:right-3");
      w.unmount();
    });

    it("turns the expanded drawer chevron down in both directions", () => {
      const w = mountGroup(true);
      const chevron = w.find('[data-test="menu-link-group-x-item"] > span[aria-hidden="true"]');
      expect(chevron.classes()).toEqual(
        expect.arrayContaining(["max-md:rotate-90", "max-md:rtl:-rotate-90"]),
      );
      w.unmount();
    });

    it("aligns the drawer label to the inline start", () => {
      const w = mountGroup(false);
      expect(w.find(".nav-menu-item-label").classes()).toContain("max-md:text-start");
      w.unmount();
    });

    it("paints the focus ring offset in the rail surface colour", () => {
      const w = mountGroup(false);
      expect(w.find('[data-test="menu-link-group-x-item"]').classes()).toEqual(
        expect.arrayContaining([
          "focus-visible:ring-offset-1",
          "focus-visible:ring-offset-surface-chrome-deeper",
        ]),
      );
      w.unmount();
    });
  });

  describe("truncated label tooltip (AC-11)", () => {
    function mountTile(props: Record<string, unknown> = {}) {
      return mount(MenuLink, {
        props: { title: "Abrechnungen", link: "/billings", ...props },
        attachTo: document.body,
        global: { plugins: [i18n, mockRouter], provide: { store } },
      });
    }

    it("marks a truncated label with data-truncated and shows the full title on keyboard focus", async () => {
      truncated.value = true;
      const w = mountTile();
      await flushPromises();
      const tile = w.find('[data-test="menu-link-/billings-item"]');
      expect(tile.attributes("data-truncated")).toBe("true");
      await tile.trigger("focus");
      await flushPromises();
      const bubble = document.querySelector('[data-test="menu-link-/billings-tooltip"]');
      expect(bubble?.textContent?.trim()).toBe("Abrechnungen");
      w.unmount();
    });

    it("shows no tooltip and no data-truncated when the label fits", async () => {
      const w = mountTile();
      await flushPromises();
      const tile = w.find('[data-test="menu-link-/billings-item"]');
      expect(tile.attributes("data-truncated")).toBeUndefined();
      await tile.trigger("focus");
      await flushPromises();
      expect(document.querySelector('[data-test="menu-link-/billings-tooltip"]')).toBeNull();
      w.unmount();
    });

    it("closes an open tooltip when a late font makes the label fit, and can open again later", async () => {
      truncated.value = true;
      const w = mountTile();
      await flushPromises();
      const tile = w.find('[data-test="menu-link-/billings-item"]');
      await tile.trigger("focus");
      await flushPromises();
      expect(document.querySelector('[data-test="menu-link-/billings-tooltip"]')).not.toBeNull();

      truncated.value = false;
      await flushPromises();
      await flushPromises();
      expect(document.querySelector('[data-test="menu-link-/billings-tooltip"]')).toBeNull();
      await tile.trigger("blur");

      truncated.value = true;
      await flushPromises();
      await tile.trigger("focus");
      await flushPromises();
      expect(document.querySelector('[data-test="menu-link-/billings-tooltip"]')).not.toBeNull();
      w.unmount();
    });

    it("cancels a pending hover-open when the label stops truncating during the delay", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        truncated.value = true;
        const w = mountTile();
        await flushPromises();
        const tile = w.find('[data-test="menu-link-/billings-item"]');
        await tile.trigger("pointermove");
        expect(document.querySelector('[data-test="menu-link-/billings-tooltip"]')).toBeNull();

        truncated.value = false;
        await flushPromises();
        await tile.trigger("pointerleave");
        vi.advanceTimersByTime(1000);
        await flushPromises();
        expect(document.querySelector('[data-test="menu-link-/billings-tooltip"]')).toBeNull();
        expect(tile.attributes("data-state")).toBe("closed");

        truncated.value = true;
        await flushPromises();
        await tile.trigger("pointerleave");
        await tile.trigger("pointermove");
        vi.advanceTimersByTime(300);
        await flushPromises();
        const bubble = document.querySelector('[data-test="menu-link-/billings-tooltip"]');
        expect(bubble?.textContent?.trim()).toBe("Abrechnungen");
        w.unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it("never gives a group tile a tooltip, even when truncated", async () => {
      truncated.value = true;
      const w = mountTile({ submenu: true });
      await flushPromises();
      const tile = w.find('[data-test="menu-link-/billings-item"]');
      expect(tile.attributes("data-truncated")).toBe("true");
      await tile.trigger("focus");
      await flushPromises();
      expect(document.querySelector('[data-test="menu-link-/billings-tooltip"]')).toBeNull();
      w.unmount();
    });

    it("re-measures when the label text changes (language switch)", async () => {
      const w = mountTile();
      updateTruncated.mockClear();
      await w.setProps({ title: "Einstellungen" });
      await flushPromises();
      expect(updateTruncated).toHaveBeenCalled();
      w.unmount();
    });

    it("keeps the full label as the accessible name", async () => {
      truncated.value = true;
      const w = mountTile();
      expect(w.find('[data-test="menu-link-/billings-item"]').attributes("aria-label")).toBe(
        "Abrechnungen",
      );
      w.unmount();
    });
  });

  describe("trial-paywalled tile (AC-14)", () => {
    function mountTile(props: Record<string, unknown> = {}) {
      return mount(MenuLink, {
        props: { title: "Logs", link: "/logs", paywalled: true, ...props },
        attachTo: document.body,
        global: { plugins: [i18n, mockRouter], provide: { store } },
      });
    }

    it("renders a muted link tile with a lock badge, data-paywalled and an accessible description", () => {
      const w = mountTile();
      const tile = w.find('[data-test="menu-link-/logs-item"]');
      expect(tile.attributes("data-paywalled")).toBe("true");
      expect(w.find('[data-test="menu-link-/logs-lock"]').exists()).toBe(true);
      const descId = tile.attributes("aria-describedby");
      expect(descId).toBeTruthy();
      expect(document.getElementById(descId!)?.textContent?.trim()).toBe("Logs needs a plan");
      expect(w.find(".nav-menu-item-label").classes()).toContain("text-text-body");
      expect(w.find(".icon-wrapper").classes()).toContain("text-text-secondary");
      // Still a real link: no disabled state, the redirect and toast follow the click.
      expect(tile.attributes("aria-disabled")).toBeUndefined();
      w.unmount();
    });

    it("says the page needs a plan in a tooltip on keyboard focus", async () => {
      const w = mountTile();
      await flushPromises();
      await w.find('[data-test="menu-link-/logs-item"]').trigger("focus");
      await flushPromises();
      const bubble = document.querySelector('[data-test="menu-link-/logs-tooltip"]');
      expect(bubble?.textContent).toContain("Logs needs a plan");
      expect(bubble?.textContent).toContain("Your trial has ended");
      w.unmount();
    });

    it("gives a muted group tile the lock and description but no tooltip", async () => {
      const w = mountTile({ title: "Data", link: "/streams", submenu: true });
      await flushPromises();
      const tile = w.find('[data-test="menu-link-/streams-item"]');
      expect(tile.attributes("data-paywalled")).toBe("true");
      expect(w.find('[data-test="menu-link-/streams-lock"]').exists()).toBe(true);
      expect(tile.attributes("aria-describedby")).toBeTruthy();
      await tile.trigger("focus");
      await flushPromises();
      expect(document.querySelector('[data-test="menu-link-/streams-tooltip"]')).toBeNull();
      w.unmount();
    });

    it("renders nothing of this when not paywalled", () => {
      const w = mountTile({ paywalled: false });
      const tile = w.find('[data-test="menu-link-/logs-item"]');
      expect(tile.attributes("data-paywalled")).toBeUndefined();
      expect(tile.attributes("aria-describedby")).toBeUndefined();
      expect(w.find('[data-test="menu-link-/logs-lock"]').exists()).toBe(false);
      w.unmount();
    });

    it("lets a notification badge take the slot over the lock", () => {
      const w = mountTile({ badge: 3 });
      expect(w.find(".menu-badge").exists()).toBe(true);
      expect(w.find('[data-test="menu-link-/logs-lock"]').exists()).toBe(false);
      w.unmount();
    });
  });
});
