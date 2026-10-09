// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ODimensionChip from "./ODimensionChip.vue";
import OTag from "./OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { dimensionVariant } from "./badgeGroups";

describe("ODimensionChip", () => {
  it("colours the chip from its dimension key", () => {
    const wrapper = mount(ODimensionChip, { props: { dimKey: "service", value: "api" } });
    expect(wrapper.findComponent(OTag).props("variant")).toBe(dimensionVariant("service"));
    expect(wrapper.text()).toContain("service");
    expect(wrapper.text()).toContain("api");
  });

  it("takes a colour override for a condition that is not a picked dimension", () => {
    const wrapper = mount(ODimensionChip, {
      props: { dimKey: "insight", value: "slowest", variant: "warning-soft" },
    });
    expect(wrapper.findComponent(OTag).props("variant")).toBe("warning-soft");
  });

  it("gives a cut value its own cut-only tooltip when the chip has none", () => {
    const wrapper = mount(ODimensionChip, { props: { dimKey: "service", value: "api" } });
    const value = wrapper.find('[data-test="o-truncated-text"]');
    expect(value.text()).toBe("api");
    expect(value.attributes("data-o-tooltip-trigger")).toBe("overflow");
  });

  it("leaves the value without a tooltip of its own when the chip shows key=value", () => {
    const wrapper = mount(ODimensionChip, {
      props: { dimKey: "service", value: "api", tooltip: true },
    });
    expect(wrapper.find('[data-test="o-truncated-text"]').attributes("data-o-tooltip-off")).toBe(
      "",
    );
  });

  it("drops the value's own tooltip when an enclosing element already explains the chip", () => {
    const wrapper = mount(ODimensionChip, {
      props: { dimKey: "service", value: "api", valueTooltip: false },
    });
    expect(wrapper.find('[data-test="o-truncated-text"]').attributes("data-o-tooltip-off")).toBe(
      "",
    );
    expect(wrapper.findAllComponents(OTooltip)).toHaveLength(0);
  });

  it("renders no dismiss affordance unless removable", () => {
    const wrapper = mount(ODimensionChip, { props: { dimKey: "service", value: "api" } });
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("emits remove from its own dismiss affordance, which carries the given data-test", async () => {
    const wrapper = mount(ODimensionChip, {
      props: {
        dimKey: "instance",
        value: "prod-1",
        removable: true,
        removeDataTest: "scope-chip-instance-remove",
      },
    });
    const remove = wrapper.find('[data-test="scope-chip-instance-remove"]');
    expect(remove.exists()).toBe(true);
    await remove.trigger("click");
    expect(wrapper.emitted("remove")).toHaveLength(1);
  });
});
