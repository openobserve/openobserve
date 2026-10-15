// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OText from "./OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";

describe("OText", () => {
  it("carries no tooltip when it does not truncate", () => {
    const wrapper = mount(OText, { slots: { default: "Plain text" } });

    expect(wrapper.findComponent(OTooltip).exists()).toBe(false);
  });

  it("shows the full text on hover only when truncated text is cut", () => {
    const wrapper = mount(OText, {
      props: { truncate: true, as: "div" },
      slots: { default: "A long caption" },
    });

    const tip = wrapper.findComponent(OTooltip);
    expect(tip.props("overflowOnly")).toBe(true);
    expect(tip.props("content")).toBeUndefined();
    expect(wrapper.classes()).toContain("truncate");
  });

  it("passes custom hover text", () => {
    const wrapper = mount(OText, {
      props: { truncate: true, tooltip: raw("Full caption") },
      slots: { default: "Cap…" },
    });

    expect(wrapper.findComponent(OTooltip).props("content")).toBe("Full caption");
  });

  it("shows no tooltip when it is turned off, and marks itself for a surrounding table", () => {
    const wrapper = mount(OText, {
      props: { truncate: true, tooltip: false },
      slots: { default: "secret" },
    });

    expect(wrapper.findComponent(OTooltip).exists()).toBe(false);
    expect(wrapper.attributes("data-o-tooltip-off")).toBe("");
  });
});
