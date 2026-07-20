// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import EmptyStateActionCard from "./EmptyStateActionCard.vue";

// Stub OIcon so we don't depend on the full icon registry at test runtime.
// We still validate that the correct name/size props are forwarded.
const oIconStub = {
  template: "<span :data-icon-name='name' :data-icon-size='size' />",
  props: ["name", "size"],
};

function mountCard(props: Record<string, unknown> = {}) {
  return mount(EmptyStateActionCard, {
    props: {
      icon: "add" as const,
      label: "Create Dashboard",
      ...props,
    },
    global: {
      stubs: { OIcon: oIconStub },
    },
  });
}

describe("EmptyStateActionCard", () => {
  // ── Rendering basics ──────────────────────────────────────────────────────

  it("renders the label text", () => {
    const wrapper = mountCard({ label: "Create Dashboard" });
    expect(wrapper.text()).toContain("Create Dashboard");
  });

  it("renders the button element with type button", () => {
    const wrapper = mountCard();
    const btn = wrapper.find("button");
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("type")).toBe("button");
  });

  // ── Icon rendering ────────────────────────────────────────────────────────

  it("renders the OIcon with the correct name prop", () => {
    const wrapper = mountCard({ icon: "database" });
    const icons = wrapper.findAll("[data-icon-name]");
    expect(icons.length).toBe(2); // tile icon + chevron icon

    const tileIcon = icons[0];
    expect(tileIcon.attributes("data-icon-name")).toBe("database");
    expect(tileIcon.attributes("data-icon-size")).toBe("md");
  });

  it("renders the icon inside the tile wrapper with correct classes", () => {
    const wrapper = mountCard();
    const tileSpan = wrapper.find("button span.rounded-lg");
    expect(tileSpan.exists()).toBe(true);
    expect(tileSpan.classes()).toContain("rounded-lg");
    expect(tileSpan.classes()).toContain("bg-tabs-active-bg");
  });

  // ── Chevron rendering ─────────────────────────────────────────────────────

  it("renders the chevron-right icon by default", () => {
    const wrapper = mountCard();
    const chevronIcon = wrapper.findAll("[data-icon-name='chevron-right']");
    expect(chevronIcon.length).toBe(1);
    expect(chevronIcon[0].attributes("data-icon-size")).toBe("sm");
  });

  it("hides the chevron when hideChevron is true", () => {
    const wrapper = mountCard({ hideChevron: true });
    const chevronIcons = wrapper.findAll("[data-icon-name='chevron-right']");
    expect(chevronIcons.length).toBe(0);
  });

  it("shows the chevron when hideChevron is false", () => {
    const wrapper = mountCard({ hideChevron: false });
    const chevronIcons = wrapper.findAll("[data-icon-name='chevron-right']");
    expect(chevronIcons.length).toBe(1);
  });

  it("shows the chevron by default when hideChevron is not passed", () => {
    const wrapper = mountCard(); // no hideChevron prop
    const chevronIcons = wrapper.findAll("[data-icon-name='chevron-right']");
    expect(chevronIcons.length).toBe(1);
  });

  // ── Sublabel ──────────────────────────────────────────────────────────────

  it("renders sublabel text when provided", () => {
    const wrapper = mountCard({ sublabel: "Set up your first dashboard" });
    expect(wrapper.text()).toContain("Set up your first dashboard");
  });

  it("does not render a sublabel element when sublabel is not provided", () => {
    const wrapper = mountCard();
    // The sublabel span uses v-if, so when undefined the element is absent.
    // The text block is the span.flex-1 child, and sublabel uses text-xs.
    const sublabelSpans = wrapper.findAll("span.flex-1 span.text-xs");
    expect(sublabelSpans.length).toBe(0);
  });

  it("does not render sublabel text when sublabel is an empty string", () => {
    // An empty string is falsy — v-if should skip it, same as undefined.
    const wrapper = mountCard({ sublabel: "" });
    const sublabelSpans = wrapper.findAll("span.flex-1 span.text-xs");
    expect(sublabelSpans.length).toBe(0);
  });

  // ── Button base classes (no hover, just structural) ───────────────────────

  it("renders the button with correct structural classes", () => {
    const wrapper = mountCard();
    const btn = wrapper.find("button");

    // Structural / display classes
    expect(btn.classes()).toContain("group");
    expect(btn.classes()).toContain("flex");
    expect(btn.classes()).toContain("items-center");
    expect(btn.classes()).toContain("rounded-xl");
    expect(btn.classes()).toContain("border");
    expect(btn.classes()).toContain("border-border-default");
    expect(btn.classes()).toContain("bg-surface-base");
    expect(btn.classes()).toContain("shadow-sm");
    expect(btn.classes()).toContain("text-left");
    expect(btn.classes()).toContain("cursor-pointer");
  });

  // ── Accessibility ─────────────────────────────────────────────────────────

  it("sets the label as the title attribute for text overflow tooltip", () => {
    const wrapper = mountCard({ label: "A Long Dashboard Name That Might Truncate" });
    const titleSpan = wrapper.find("button span span[title]");
    expect(titleSpan.exists()).toBe(true);
    expect(titleSpan.attributes("title")).toBe("A Long Dashboard Name That Might Truncate");
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("renders without a sublabel and without a chevron (minimal config)", () => {
    const wrapper = mountCard({ hideChevron: true });
    // Should still render the label and the tile icon
    expect(wrapper.text()).toContain("Create Dashboard");
    expect(wrapper.find("[data-icon-name='add']").exists()).toBe(true);
    expect(wrapper.findAll("[data-icon-name='chevron-right']").length).toBe(0);
  });

  it("renders all three sections: icon tile, text block, and chevron", () => {
    const wrapper = mountCard({ sublabel: "Get started with observability" });
    // The button should have 3 direct children: tile span, text span, chevron icon
    const root = wrapper.find("button");
    // Quasar stubs or wrapper internals may add extra nodes — check by content instead
    expect(wrapper.text()).toContain("Create Dashboard");
    expect(wrapper.text()).toContain("Get started with observability");
    expect(wrapper.find("[data-icon-name='chevron-right']").exists()).toBe(true);
  });
});
