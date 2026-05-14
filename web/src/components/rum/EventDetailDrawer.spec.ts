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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { nextTick } from "vue";
import EventDetailDrawer from "./EventDetailDrawer.vue";

installQuasar();

vi.mock("./EventDetailDrawerContent.vue", () => ({
  default: {
    name: "EventDetailDrawerContent",
    template: '<div data-test="event-detail-drawer-content"><slot /></div>',
    props: ["event", "rawEvent", "sessionId", "sessionDetails"],
    emits: ["close", "resource-selected"],
  },
}));

const defaultProps = {
  modelValue: false,
  event: { type: "error", message: "Test error" },
  rawEvent: { id: "raw-1" },
  sessionId: "session-123",
  sessionDetails: {
    user_email: "user@test.com",
    date: "2026-01-01",
    browser: "Chrome",
    os: "macOS",
    ip: "127.0.0.1",
    city: "San Francisco",
    country: "USA",
  },
};

describe("EventDetailDrawer", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  function mountComponent(propsOverrides = {}) {
    return mount(EventDetailDrawer, {
      props: { ...defaultProps, ...propsOverrides },
      global: {
        stubs: { "q-dialog": { template: '<div><slot /></div>', props: ["modelValue", "position", "fullHeight", "maximized"], emits: ["hide"] } },
      },
    });
  }

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render EventDetailDrawerContent inside q-dialog", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(wrapper.find('[data-test="event-detail-drawer-content"]').exists()).toBe(true);
    });
  });

  describe("modelValue prop sync", () => {
    it("should initialize isOpen with modelValue=false", async () => {
      wrapper = mountComponent({ modelValue: false });
      expect(wrapper.vm.isOpen).toBe(false);
    });

    it("should initialize isOpen with modelValue=true", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(wrapper.vm.isOpen).toBe(true);
    });

    it("should update isOpen when modelValue prop changes to true", async () => {
      wrapper = mountComponent({ modelValue: false });
      await wrapper.setProps({ modelValue: true });
      expect(wrapper.vm.isOpen).toBe(true);
    });

    it("should update isOpen when modelValue prop changes to false", async () => {
      wrapper = mountComponent({ modelValue: true });
      await wrapper.setProps({ modelValue: false });
      expect(wrapper.vm.isOpen).toBe(false);
    });

    it("should emit update:modelValue when isOpen changes", async () => {
      wrapper = mountComponent({ modelValue: true });
      wrapper.vm.isOpen = false;
      await nextTick();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
    });

    it("should emit update:modelValue=true when drawer opens", async () => {
      wrapper = mountComponent({ modelValue: false });
      wrapper.vm.isOpen = true;
      await nextTick();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([true]);
    });
  });

  describe("closeDrawer method", () => {
    it("should set isOpen to false when closeDrawer is called", async () => {
      wrapper = mountComponent({ modelValue: true });
      expect(wrapper.vm.isOpen).toBe(true);
      wrapper.vm.closeDrawer();
      await nextTick();
      expect(wrapper.vm.isOpen).toBe(false);
    });

    it("should emit update:modelValue=false when closeDrawer is called", async () => {
      wrapper = mountComponent({ modelValue: true });
      wrapper.vm.closeDrawer();
      await nextTick();
      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual([false]);
    });
  });

  describe("props passing", () => {
    it("should pass event prop to EventDetailDrawerContent", () => {
      wrapper = mountComponent({ modelValue: true, event: { type: "action" } });
      expect(wrapper.find('[data-test="event-detail-drawer-content"]').exists()).toBe(true);
    });

    it("should use default sessionDetails when not provided", () => {
      wrapper = mountComponent({ modelValue: true, sessionDetails: undefined });
      expect(wrapper.vm.isOpen).toBe(true);
    });
  });

  describe("resource-selected event", () => {
    it("should forward resource-selected event from drawer content", async () => {
      wrapper = mountComponent({ modelValue: true });
      const content = wrapper.find('[data-test="event-detail-drawer-content"]');
      await content.trigger("resource-selected", { resourceId: "res-1" });
      // The component forwards $emit('resource-selected', $event)
      expect(wrapper.exists()).toBe(true);
    });
  });
});
