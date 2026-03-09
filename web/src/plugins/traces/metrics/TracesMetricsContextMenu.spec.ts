// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import TracesMetricsContextMenu from "./TracesMetricsContextMenu.vue";

installQuasar();

const defaultProps = {
  visible: true,
  x: 100,
  y: 200,
  value: 42,
  fieldName: "Duration",
};

describe("TracesMetricsContextMenu", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    wrapper = mount(TracesMetricsContextMenu, {
      props: defaultProps,
    });
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("should mount without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the menu when visible=true", () => {
      const menu = wrapper.find('[data-test="traces-metrics-context-menu"]');
      expect(menu.exists()).toBe(true);
    });

    it("should not render the menu when visible=false", async () => {
      await wrapper.setProps({ visible: false });
      const menu = wrapper.find('[data-test="traces-metrics-context-menu"]');
      expect(menu.exists()).toBe(false);
    });

    it("should render the gte menu item", () => {
      const gteItem = wrapper.find('[data-test="context-menu-gte"]');
      expect(gteItem.exists()).toBe(true);
    });

    it("should render the lte menu item", () => {
      const lteItem = wrapper.find('[data-test="context-menu-lte"]');
      expect(lteItem.exists()).toBe(true);
    });

    it("should show fieldName and formatted value in gte item", () => {
      const gteItem = wrapper.find('[data-test="context-menu-gte"]');
      expect(gteItem.text()).toContain("Duration");
      expect(gteItem.text()).toContain("42");
    });

    it("should show fieldName and formatted value in lte item", () => {
      const lteItem = wrapper.find('[data-test="context-menu-lte"]');
      expect(lteItem.text()).toContain("Duration");
      expect(lteItem.text()).toContain("42");
    });
  });

  describe("positioning", () => {
    it("should apply correct position styles", () => {
      const menu = wrapper.find('[data-test="traces-metrics-context-menu"]');
      const style = menu.attributes("style");
      expect(style).toContain("left: 100px");
      expect(style).toContain("top: 200px");
    });

    it("should update position when x and y props change", async () => {
      await wrapper.setProps({ x: 300, y: 400 });
      const menu = wrapper.find('[data-test="traces-metrics-context-menu"]');
      const style = menu.attributes("style");
      expect(style).toContain("left: 300px");
      expect(style).toContain("top: 400px");
    });
  });

  describe("value formatting", () => {
    it("should format numeric values with up to 2 decimal places", async () => {
      await wrapper.setProps({ value: 1234.567 });
      const gteItem = wrapper.find('[data-test="context-menu-gte"]');
      // toLocaleString with maximumFractionDigits: 2
      expect(gteItem.text()).toContain("1,234.57");
    });

    it("should display string values as-is", async () => {
      await wrapper.setProps({ value: "custom-value" });
      const gteItem = wrapper.find('[data-test="context-menu-gte"]');
      expect(gteItem.text()).toContain("custom-value");
    });

    it("should display default fieldName 'Value' when not provided", async () => {
      const defaultWrapper = mount(TracesMetricsContextMenu, {
        props: { visible: true, x: 0, y: 0, value: 10 },
      });
      const gteItem = defaultWrapper.find('[data-test="context-menu-gte"]');
      expect(gteItem.text()).toContain("Value");
      defaultWrapper.unmount();
    });
  });

  describe("events", () => {
    it("should emit 'select' with gte condition when gte item is clicked", async () => {
      const gteItem = wrapper.find('[data-test="context-menu-gte"]');
      await gteItem.trigger("click");
      const emitted = wrapper.emitted("select");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toEqual({
        condition: "gte",
        value: 42,
        fieldName: "Duration",
      });
    });

    it("should emit 'select' with lte condition when lte item is clicked", async () => {
      const lteItem = wrapper.find('[data-test="context-menu-lte"]');
      await lteItem.trigger("click");
      const emitted = wrapper.emitted("select");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toEqual({
        condition: "lte",
        value: 42,
        fieldName: "Duration",
      });
    });

    it("should emit 'close' when Escape key is pressed", async () => {
      vi.useFakeTimers();

      // Toggle visible false→true to fire the watcher (component mounts with
      // visible=true already, so Vue watcher only triggers on actual change)
      await wrapper.setProps({ visible: false });
      await wrapper.setProps({ visible: true });

      // Flush the setTimeout(0) inside the watcher that attaches event listeners
      vi.runAllTimers();
      vi.useRealTimers();

      // Dispatch a keydown Escape event
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

      await flushPromises();
      const emitted = wrapper.emitted("close");
      expect(emitted).toBeTruthy();
    });
  });

  describe("cleanup", () => {
    it("should remove event listeners on unmount", () => {
      const removeSpy = vi.spyOn(document, "removeEventListener");
      wrapper.unmount();
      expect(removeSpy).toHaveBeenCalled();
      removeSpy.mockRestore();
      // Re-create wrapper for afterEach
      wrapper = mount(TracesMetricsContextMenu, { props: defaultProps });
    });
  });
});
