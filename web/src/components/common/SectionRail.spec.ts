// @vitest-environment jsdom
// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import SectionRail from "./SectionRail.vue";

const push = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

const groups = [
  {
    label: "Monitor",
    items: [{ key: "insights", label: "Insights", icon: "insights", to: { name: "a" } }],
  },
  {
    label: "Experiment",
    items: [{ key: "playground", label: "Playground", icon: "play-circle", to: { name: "b" } }],
  },
] as any;

const stubs = {
  OTabs: { template: "<div><slot /></div>" },
  OTab: {
    name: "OTab",
    props: ["name", "label", "icon", "tooltip"],
    template: "<button :data-name='name'>{{ label }}</button>",
  },
  OButton: {
    emits: ["click"],
    template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
  },
  OIcon: { props: ["name"], template: "<i :data-icon='name' />" },
  OTooltip: { name: "OTooltip", props: ["content"], template: "<span />" },
};

function mountRail(props: Record<string, unknown> = {}) {
  return mount(SectionRail, {
    props: { groups, title: "AI Observability", ...props },
    global: { stubs },
  });
}

describe("SectionRail", () => {
  beforeEach(() => {
    push.mockReset();
  });

  // Settings and IAM share this component and never opted in; their header must
  // stay exactly as it was.
  it("shows no toggle unless the rail opted in", () => {
    const wrapper = mountRail();
    expect(wrapper.find('[data-test="section-rail-toggle"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("AI Observability");
  });

  it("keeps the title and every label while expanded", () => {
    const wrapper = mountRail({ collapsible: true, icon: "auto-awesome" });
    expect(wrapper.text()).toContain("AI Observability");
    expect(wrapper.text()).toContain("Insights");
    expect(wrapper.text()).toContain("Monitor");
  });

  it("drops the labels and the title once collapsed", async () => {
    const wrapper = mountRail({ collapsible: true, icon: "auto-awesome" });
    await wrapper.get('[data-test="section-rail-toggle"]').trigger("click");

    expect(wrapper.text()).not.toContain("AI Observability");
    expect(wrapper.text()).not.toContain("Insights");
    expect(wrapper.find('[data-icon="auto-awesome"]').exists()).toBe(true);
  });

  // The label has to survive somewhere, or a collapsed rail is a column of
  // unexplained glyphs.
  it("moves each label into a tooltip when collapsed", async () => {
    const wrapper = mountRail({ collapsible: true, icon: "auto-awesome" });
    const tab = () => wrapper.findComponent({ name: "OTab" });

    expect(tab().props("tooltip")).toBeUndefined();
    await wrapper.get('[data-test="section-rail-toggle"]').trigger("click");
    expect(tab().props("tooltip")).toBe("Insights");
    expect(tab().props("label")).toBeUndefined();
  });

  // The headings do not fit, but running four sections into one list of icons
  // loses the grouping entirely.
  it("replaces group headings with a rule when collapsed", async () => {
    const wrapper = mountRail({ collapsible: true, icon: "auto-awesome" });
    expect(wrapper.find('[data-test="section-rail-group-divider"]').exists()).toBe(false);

    await wrapper.get('[data-test="section-rail-toggle"]').trigger("click");
    expect(wrapper.text()).not.toContain("Experiment");
    // One rule BETWEEN two groups, not one above each.
    expect(wrapper.findAll('[data-test="section-rail-group-divider"]')).toHaveLength(1);
  });

  // The mark stands in for the title it replaced, so it has to say which module
  // the rail belongs to — "Expand" alone leaves a collapsed rail unlabelled.
  it("names the module on the collapsed control", async () => {
    const wrapper = mountRail({ collapsible: true, icon: "auto-awesome" });
    await wrapper.get('[data-test="section-rail-toggle"]').trigger("click");

    const toggle = wrapper.get('[data-test="section-rail-toggle"]');
    expect(toggle.attributes("aria-label")).toBe("AI Observability");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.findComponent({ name: "OTooltip" }).props("content")).toBe("AI Observability");
  });

  it("reopens from the collapsed control", async () => {
    const wrapper = mountRail({ collapsible: true, icon: "auto-awesome" });
    await wrapper.get('[data-test="section-rail-toggle"]').trigger("click");
    await wrapper.get('[data-test="section-rail-toggle"]').trigger("click");
    expect(wrapper.text()).toContain("AI Observability");
  });

  // Otherwise the rail renders collapsed with no control to reopen it.
  it("ignores `collapsed` from a rail that never opted in", () => {
    const wrapper = mountRail({ collapsed: true });
    expect(wrapper.text()).toContain("AI Observability");
    expect(wrapper.text()).toContain("Insights");
  });

  // The owner holds the state, because it also sizes the rail.
  it("reports the change to its owner rather than keeping it", async () => {
    const wrapper = mountRail({ collapsible: true, icon: "auto-awesome" });
    await wrapper.get('[data-test="section-rail-toggle"]').trigger("click");
    expect(wrapper.emitted("update:collapsed")?.[0]).toEqual([true]);
  });

  it("still navigates from a collapsed item", async () => {
    const wrapper = mountRail({ collapsible: true, icon: "auto-awesome" });
    await wrapper.get('[data-test="section-rail-toggle"]').trigger("click");
    await wrapper.get('[data-name="insights"]').trigger("click");
    expect(push).toHaveBeenCalledWith({ name: "a" });
  });
});
