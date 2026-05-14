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
    template:
      '<div data-test="event-detail-drawer-content"><slot /></div>',
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

  function mountComponent(propsOverrides = {}) {
    return mount(EventDetailDrawer, {
      props: { ...defaultProps, ...propsOverrides },
    });
  }

  function getContent(w: VueWrapper) {
    return w.findComponent({ name: "EventDetailDrawerContent" });
  }

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render EventDetailDrawerContent", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(
        wrapper.find('[data-test="event-detail-drawer-content"]').exists(),
      ).toBe(true);
    });
  });

  describe("open prop sync (modelValue -> EventDetailDrawerContent.open)", () => {
    it("should pass open=false when modelValue is false", () => {
      wrapper = mountComponent({ modelValue: false });
      expect(getContent(wrapper).props("open")).toBe(false);
    });

    it("should pass open=true when modelValue is true", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(getContent(wrapper).props("open")).toBe(true);
    });

    it("should update open prop when modelValue prop changes to true", async () => {
      wrapper = mountComponent({ modelValue: false });
      await wrapper.setProps({ modelValue: true });
      expect(getContent(wrapper).props("open")).toBe(true);
    });

    it("should update open prop when modelValue prop changes to false", async () => {
      wrapper = mountComponent({ modelValue: true });
      await wrapper.setProps({ modelValue: false });
      expect(getContent(wrapper).props("open")).toBe(false);
    });
  });

  describe("update:open -> update:modelValue forwarding", () => {
    it("should emit update:modelValue=false when content emits update:open=false", async () => {
      wrapper = mountComponent({ modelValue: true });
      await getContent(wrapper).vm.$emit("update:open", false);
      await nextTick();
      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual([false]);
    });

    it("should emit update:modelValue=true when content emits update:open=true", async () => {
      wrapper = mountComponent({ modelValue: false });
      await getContent(wrapper).vm.$emit("update:open", true);
      await nextTick();
      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual([true]);
    });

    it("should not emit update:modelValue on mount", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });
  });

  describe("props passing", () => {
    it("should pass event prop to EventDetailDrawerContent", () => {
      const event = { type: "action", message: "click" };
      wrapper = mountComponent({ modelValue: true, event });
      expect(getContent(wrapper).props("event")).toEqual(event);
    });

    it("should pass rawEvent prop to EventDetailDrawerContent", () => {
      const rawEvent = { id: "raw-42", payload: { foo: "bar" } };
      wrapper = mountComponent({ modelValue: true, rawEvent });
      expect(getContent(wrapper).props("rawEvent")).toEqual(rawEvent);
    });

    it("should pass sessionId prop to EventDetailDrawerContent", () => {
      wrapper = mountComponent({
        modelValue: true,
        sessionId: "session-abc",
      });
      expect(getContent(wrapper).props("sessionId")).toBe("session-abc");
    });

    it("should pass sessionDetails prop to EventDetailDrawerContent", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(getContent(wrapper).props("sessionDetails")).toEqual(
        defaultProps.sessionDetails,
      );
    });

    it("should use default sessionDetails when not provided", () => {
      wrapper = mountComponent({
        modelValue: true,
        sessionDetails: undefined,
      });
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

    it("should use default event when not provided", () => {
      wrapper = mountComponent({ modelValue: true, event: undefined });
      expect(getContent(wrapper).props("event")).toEqual({});
    });

    it("should use default rawEvent when not provided", () => {
      wrapper = mountComponent({ modelValue: true, rawEvent: undefined });
      expect(getContent(wrapper).props("rawEvent")).toEqual({});
    });

    it("should use default sessionId when not provided", () => {
      wrapper = mountComponent({ modelValue: true, sessionId: undefined });
      expect(getContent(wrapper).props("sessionId")).toBe("");
    });

    it("should default modelValue to false when not provided", () => {
      wrapper = mount(EventDetailDrawer, { props: {} });
      expect(getContent(wrapper).props("open")).toBe(false);
    });
  });

  describe("resource-selected event", () => {
    it("should forward resource-selected event from drawer content", async () => {
      wrapper = mountComponent({ modelValue: true });
      const payload = { resourceId: "res-1" };
      await getContent(wrapper).vm.$emit("resource-selected", payload);
      await nextTick();
      const emitted = wrapper.emitted("resource-selected");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual([payload]);
    });

    it("should forward multiple resource-selected events", async () => {
      wrapper = mountComponent({ modelValue: true });
      await getContent(wrapper).vm.$emit("resource-selected", { id: "a" });
      await getContent(wrapper).vm.$emit("resource-selected", { id: "b" });
      await nextTick();
      const emitted = wrapper.emitted("resource-selected");
      expect(emitted).toHaveLength(2);
      expect(emitted![0]).toEqual([{ id: "a" }]);
      expect(emitted![1]).toEqual([{ id: "b" }]);
    });

    it("should not emit resource-selected when content does not emit it", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(wrapper.emitted("resource-selected")).toBeFalsy();
    });
  });
});
