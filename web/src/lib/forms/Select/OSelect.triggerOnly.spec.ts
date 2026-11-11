// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import OSelect from "./OSelect.vue";
import { raw } from "@/types/i18n";

const options = [
  { label: raw("Line"), value: "line" },
  { label: raw("Bar"), value: "bar" },
];

describe("OSelect triggerOnly", () => {
  let wrapper: VueWrapper;

  afterEach(() => wrapper?.unmount());

  const mountSelect = (props: Record<string, unknown> = {}) =>
    mount(OSelect, {
      attachTo: document.body,
      props: { modelValue: "line", options, label: raw("Chart type"), triggerOnly: true, ...props },
    });

  it("emits trigger-click on click and opens no popup in listbox mode", async () => {
    wrapper = mountSelect({ searchable: true });
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(wrapper.emitted("trigger-click")).toHaveLength(1);
    expect(wrapper.emitted("open")).toBeUndefined();
    expect(document.body.querySelectorAll("[role='option']")).toHaveLength(0);
  });

  it("emits trigger-click from the keyboard and opens no popup in select mode", async () => {
    wrapper = mountSelect({ searchable: false });
    await wrapper.find('button[role="combobox"]').trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(wrapper.emitted("trigger-click")).toHaveLength(1);
    expect(wrapper.emitted("open")).toBeUndefined();
    expect(document.body.querySelectorAll("[role='option']")).toHaveLength(0);
  });

  it("does not open from a typed character or focus()", async () => {
    wrapper = mountSelect();
    await wrapper.find("button").trigger("keydown", { key: "b" });
    (wrapper.vm as unknown as { focus: () => void }).focus();
    await flushPromises();

    expect(wrapper.emitted("open")).toBeUndefined();
    expect(document.body.querySelectorAll("[role='option']")).toHaveLength(0);
  });

  it("points the chevron up only while expanded", async () => {
    wrapper = mountSelect({ expanded: false });
    expect(wrapper.find(".rotate-180").exists()).toBe(false);
    await wrapper.setProps({ expanded: true });
    expect(wrapper.find(".rotate-180").exists()).toBe(true);
  });

  it("still opens its own popup without triggerOnly", async () => {
    wrapper = mountSelect({ triggerOnly: false });
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(wrapper.emitted("trigger-click")).toBeUndefined();
    expect(wrapper.emitted("open")).toHaveLength(1);
  });
});
