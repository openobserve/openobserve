// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OCode from "./OCode.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";

describe("OCode", () => {
  it("renders inline text as is when it does not truncate", () => {
    const wrapper = mount(OCode, { slots: { default: "0 0 * * *" } });

    expect(wrapper.findComponent(OTruncatedText).exists()).toBe(false);
    expect(wrapper.text()).toBe("0 0 * * *");
  });

  it("cuts the text inside its own box, keeping the copy button outside it", () => {
    const wrapper = mount(OCode, {
      props: { truncate: true, copyable: true },
      slots: { default: "refs/heads/feature/very-long-branch-name" },
    });

    const text = wrapper.findComponent(OTruncatedText);
    expect(text.exists()).toBe(true);
    expect(text.text()).toBe("refs/heads/feature/very-long-branch-name");
    expect(text.find("button").exists()).toBe(false);
    expect(wrapper.find("code > button").exists()).toBe(true);
    expect(wrapper.find("code").classes()).toContain("max-w-full");
    expect(wrapper.find("code").classes()).not.toContain("truncate");
  });

  it("passes custom hover text to the cut-only tooltip", () => {
    const wrapper = mount(OCode, {
      props: { truncate: true, tooltip: raw("Full reference") },
      slots: { default: "refs/heads/x" },
    });

    const tip = wrapper.findComponent(OTooltip);
    expect(tip.props("overflowOnly")).toBe(true);
    expect(tip.props("content")).toBe("Full reference");
  });

  it("shows no tooltip for a secret and marks it so a table never shows it either", () => {
    const wrapper = mount(OCode, {
      props: { truncate: true, tooltip: false },
      slots: { default: "secret-value" },
    });

    expect(wrapper.findComponent(OTooltip).exists()).toBe(false);
    expect(wrapper.findComponent(OTruncatedText).attributes("data-o-tooltip-off")).toBe("");
  });
});
