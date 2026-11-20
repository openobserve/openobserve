// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ODimensionChip from "./ODimensionChip.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const chip = (w: ReturnType<typeof mount>) => w.get('[data-test="o-dimension-chip"]');

describe("ODimensionChip", () => {
  it("renders a mono key on a subtle fill, then the strong value", () => {
    const wrapper = mount(ODimensionChip, { props: { dimKey: "service", value: "api" } });
    expect(chip(wrapper).classes()).toEqual(
      expect.arrayContaining(["rounded-chip", "font-mono", "border-border-default"]),
    );
    const key = chip(wrapper).find("span.border-e");
    expect(key.text()).toBe("service");
    expect(key.classes()).toContain("bg-surface-subtle");
    expect(wrapper.get('[data-test="o-truncated-text"]').classes()).toContain("text-text-heading");
  });

  it("takes a tone for a condition that is not a picked dimension", () => {
    const wrapper = mount(ODimensionChip, {
      props: { dimKey: "insight", value: "slowest", tone: "warn" },
    });
    expect(chip(wrapper).classes()).toContain("bg-badge-warning-soft-bg");
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

  it("keeps every dimension neutral, whatever its key", () => {
    for (const dimKey of ["where", "version", "region", "env"]) {
      const w = mount(ODimensionChip, { props: { dimKey, value: "x" } });
      expect(chip(w).classes(), dimKey).toContain("bg-surface-base");
    }
  });
  it("renders a qualifier as a third segment inside the chip, after the value", () => {
    const wrapper = mount(ODimensionChip, {
      props: { dimKey: "env", value: "prod", qualifier: "inferred", qualifierDataTest: "q" },
    });
    const qualifier = wrapper.get('[data-test="q"]');
    expect(qualifier.text()).toBe("inferred");
    expect(chip(wrapper).text()).toBe("envprodinferred");
  });

  it("drops the key segment when the surrounding column already names the dimension", () => {
    const wrapper = mount(ODimensionChip, {
      props: { dimKey: "env", value: "prod", qualifier: "inferred", hideKey: true },
    });
    expect(chip(wrapper).text()).toBe("prodinferred");
  });

  it("renders no qualifier segment when the prop is absent", () => {
    const wrapper = mount(ODimensionChip, { props: { dimKey: "env", value: "prod" } });
    expect(chip(wrapper).text()).toBe("envprod");
  });

  it("keeps the dismiss affordance on a removable chip that also gets a qualifier", () => {
    const wrapper = mount(ODimensionChip, {
      props: { dimKey: "env", value: "prod", qualifier: "inferred", removable: true },
    });
    expect(wrapper.find("button").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("inferred");
  });
});
