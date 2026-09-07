// Copyright 2026 OpenObserve Inc.

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ExperimentRowContentBox from "./ExperimentRowContentBox.vue";

const stubs = {
  global: {
    stubs: {
      OTag: { props: ["label"], template: "<span>{{ label }}</span>" },
      OButton: {
        props: ["iconLeft", "title"],
        emits: ["click"],
        template:
          '<button :title="title" :data-icon="iconLeft" @click="$emit(\'click\')"><slot /></button>',
      },
      LLMContentRenderer: { props: ["content"], template: "<div>{{ content }}</div>" },
    },
  },
};

function mountBox(props: Record<string, unknown> = {}) {
  return mount(ExperimentRowContentBox, {
    props: { label: "Input", value: "hello", dataTest: "box", ...props } as any,
    ...stubs,
  });
}

describe("ExperimentRowContentBox", () => {
  it("renders its own label and, when given one, the source tag", () => {
    const wrapper = mountBox({ tagLabel: "From Dataset" });
    expect(wrapper.text()).toContain("Input");
    expect(wrapper.text()).toContain("From Dataset");
  });

  it("omits the tag when the box has no source to name", () => {
    const wrapper = mountBox();
    expect(wrapper.find("span").exists()).toBe(false);
  });

  it("emits its own root element when the fullscreen button is clicked", async () => {
    const wrapper = mountBox();
    await wrapper.get('[data-test="box-fullscreen"]').trigger("click");

    const emitted = wrapper.emitted("toggle-fullscreen");
    expect(emitted).toHaveLength(1);
    expect(emitted![0][0]).toBe(wrapper.element);
  });

  it("shows Enter Fullscreen until the parent reports this box IS the fullscreen element", () => {
    const collapsed = mountBox({ fullscreen: false });
    expect(collapsed.get('[data-test="box-fullscreen"]').attributes("title")).toBe(
      "Enter Fullscreen",
    );
    expect(collapsed.get('[data-test="box-fullscreen"]').attributes("data-icon")).toBe(
      "fullscreen",
    );

    const expanded = mountBox({ fullscreen: true });
    expect(expanded.get('[data-test="box-fullscreen"]').attributes("title")).toBe(
      "Exit Fullscreen",
    );
    expect(expanded.get('[data-test="box-fullscreen"]').attributes("data-icon")).toBe(
      "fullscreen-exit",
    );
  });

  it("says the side is absent, not empty, when the run never produced it", () => {
    const wrapper = mountBox({ absent: true, value: null });
    expect(wrapper.text()).toContain("Not present in this run");
    expect(wrapper.text()).not.toContain("Not provided");
  });

  it("says content is missing, distinct from absent, when the side exists but has none", () => {
    const wrapper = mountBox({ value: null });
    expect(wrapper.text()).toContain("Not provided");
  });
});
