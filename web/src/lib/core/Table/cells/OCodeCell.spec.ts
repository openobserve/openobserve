// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OCodeCell from "./OCodeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";

const valueSpan = (wrapper: ReturnType<typeof mount>) => wrapper.find("span.font-mono");

describe("OCodeCell", () => {
  it("shows the full value on hover only when it is cut, with no always-on title", () => {
    const wrapper = mount(OCodeCell, { props: { value: "trace-0123456789" } });

    expect(valueSpan(wrapper).attributes("title")).toBeUndefined();
    const tip = wrapper.findComponent(OTooltip);
    expect(tip.props("overflowOnly")).toBe(true);
    expect(tip.props("content")).toBeUndefined();
  });

  it("shows the given text on hover in place of the value", () => {
    const wrapper = mount(OCodeCell, {
      props: { value: "abc", tooltip: raw("Full value: abc-def") },
    });

    expect(wrapper.findComponent(OTooltip).props("content")).toBe("Full value: abc-def");
  });

  it("never puts a secret on hover when the tooltip is off, and marks it for the table", () => {
    const wrapper = mount(OCodeCell, {
      props: { value: "Basic dXNlcjpzZWNyZXQ=", tooltip: false },
    });

    expect(wrapper.findComponent(OTooltip).exists()).toBe(false);
    expect(valueSpan(wrapper).attributes("title")).toBeUndefined();
    expect(valueSpan(wrapper).attributes("data-o-tooltip-off")).toBe("");
    expect(valueSpan(wrapper).text()).toBe("Basic dXNlcjpzZWNyZXQ=");
  });
});
