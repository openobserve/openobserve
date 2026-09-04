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

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import EventDetailDrawer from "./EventDetailDrawer.vue";

vi.mock("./EventDetailDrawerContent.vue", () => ({
  default: {
    name: "EventDetailDrawerContent",
    template: '<div data-test="event-detail-drawer-content"><slot /></div>',
    props: ["open", "event", "rawEvent", "sessionId", "sessionDetails"],
    emits: ["update:open", "resource-selected"],
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

  function mountComponent(propsOverrides: Record<string, any> = {}) {
    return mount(EventDetailDrawer, {
      props: { ...defaultProps, ...propsOverrides },
    });
  }

  function getContent(w: VueWrapper) {
    return w.findComponent({ name: "EventDetailDrawerContent" });
  }

  describe("initial render", () => {
    it("renders without errors when mounted with default props", () => {
      // Arrange & Assert
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders EventDetailDrawerContent when modelValue is true", () => {
      // Arrange & Assert
      wrapper = mountComponent({ modelValue: true });
      expect(wrapper.find('[data-test="event-detail-drawer-content"]').exists()).toBe(true);
    });
  });

  describe("open prop sync (modelValue -> EventDetailDrawerContent.open)", () => {
    it("passes open=false to EventDetailDrawerContent when modelValue is false", () => {
      // Arrange & Assert
      wrapper = mountComponent({ modelValue: false });
      expect(getContent(wrapper).props("open")).toBe(false);
    });

    it("passes open=true to EventDetailDrawerContent when modelValue is true", () => {
      // Arrange & Assert
      wrapper = mountComponent({ modelValue: true });
      expect(getContent(wrapper).props("open")).toBe(true);
    });

    it("updates open prop to true when modelValue prop changes from false to true", async () => {
      // Arrange
      wrapper = mountComponent({ modelValue: false });

      // Act
      await wrapper.setProps({ modelValue: true });

      // Assert
      expect(getContent(wrapper).props("open")).toBe(true);
    });

    it("updates open prop to false when modelValue prop changes from true to false", async () => {
      // Arrange
      wrapper = mountComponent({ modelValue: true });

      // Act
      await wrapper.setProps({ modelValue: false });

      // Assert
      expect(getContent(wrapper).props("open")).toBe(false);
    });
  });

  describe("update:open -> update:modelValue forwarding", () => {
    it("emits update:modelValue with false when content emits update:open with false", async () => {
      // Arrange
      wrapper = mountComponent({ modelValue: true });

      // Act
      await getContent(wrapper).vm.$emit("update:open", false);
      await nextTick();

      // Assert
      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual([false]);
    });

    it("emits update:modelValue with true when content emits update:open with true", async () => {
      // Arrange
      wrapper = mountComponent({ modelValue: false });

      // Act
      await getContent(wrapper).vm.$emit("update:open", true);
      await nextTick();

      // Assert
      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual([true]);
    });

    it("does not emit update:modelValue on initial mount", () => {
      // Arrange & Assert
      wrapper = mountComponent({ modelValue: true });
      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });
  });

  describe("props passing", () => {
    it("passes event prop to EventDetailDrawerContent", () => {
      // Arrange
      const event = { type: "action", message: "click" };

      // Act
      wrapper = mountComponent({ modelValue: true, event });

      // Assert
      expect(getContent(wrapper).props("event")).toEqual(event);
    });

    it("passes rawEvent prop to EventDetailDrawerContent", () => {
      // Arrange
      const rawEvent = { id: "raw-42", payload: { foo: "bar" } };

      // Act
      wrapper = mountComponent({ modelValue: true, rawEvent });

      // Assert
      expect(getContent(wrapper).props("rawEvent")).toEqual(rawEvent);
    });

    it("passes sessionId prop to EventDetailDrawerContent", () => {
      // Arrange & Act
      wrapper = mountComponent({ modelValue: true, sessionId: "session-abc" });

      // Assert
      expect(getContent(wrapper).props("sessionId")).toBe("session-abc");
    });

    it("passes sessionDetails prop to EventDetailDrawerContent", () => {
      // Arrange & Act
      wrapper = mountComponent({ modelValue: true });

      // Assert
      expect(getContent(wrapper).props("sessionDetails")).toEqual(defaultProps.sessionDetails);
    });

    it("uses default empty sessionDetails when sessionDetails prop is not provided", () => {
      // Arrange & Act
      wrapper = mountComponent({ modelValue: true, sessionDetails: undefined });

      // Assert
      expect(getContent(wrapper).props("sessionDetails")).toEqual({
        user_email: "",
        date: "",
        browser: "",
        os: "",
        ip: "",
        city: "",
        country: "",
      });
    });

    it("uses default empty event when event prop is not provided", () => {
      // Arrange & Act
      wrapper = mountComponent({ modelValue: true, event: undefined });

      // Assert
      expect(getContent(wrapper).props("event")).toEqual({});
    });

    it("uses default empty rawEvent when rawEvent prop is not provided", () => {
      // Arrange & Act
      wrapper = mountComponent({ modelValue: true, rawEvent: undefined });

      // Assert
      expect(getContent(wrapper).props("rawEvent")).toEqual({});
    });

    it("uses default empty string sessionId when sessionId prop is not provided", () => {
      // Arrange & Act
      wrapper = mountComponent({ modelValue: true, sessionId: undefined });

      // Assert
      expect(getContent(wrapper).props("sessionId")).toBe("");
    });

    it("defaults modelValue to false and passes open=false when no props are provided", () => {
      // Arrange & Act
      wrapper = mount(EventDetailDrawer, { props: {} });

      // Assert
      expect(getContent(wrapper).props("open")).toBe(false);
    });
  });

  describe("resource-selected event", () => {
    it("forwards resource-selected event from drawer content to parent", async () => {
      // Arrange
      wrapper = mountComponent({ modelValue: true });
      const payload = { resourceId: "res-1" };

      // Act
      await getContent(wrapper).vm.$emit("resource-selected", payload);
      await nextTick();

      // Assert
      const emitted = wrapper.emitted("resource-selected");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual([payload]);
    });

    it("forwards multiple resource-selected events in order", async () => {
      // Arrange
      wrapper = mountComponent({ modelValue: true });

      // Act
      await getContent(wrapper).vm.$emit("resource-selected", { id: "a" });
      await getContent(wrapper).vm.$emit("resource-selected", { id: "b" });
      await nextTick();

      // Assert
      const emitted = wrapper.emitted("resource-selected");
      expect(emitted).toHaveLength(2);
      expect(emitted![0]).toEqual([{ id: "a" }]);
      expect(emitted![1]).toEqual([{ id: "b" }]);
    });

    it("does not emit resource-selected when content has not emitted it", () => {
      // Arrange & Assert
      wrapper = mountComponent({ modelValue: true });
      expect(wrapper.emitted("resource-selected")).toBeFalsy();
    });
  });
});
