// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OBadge from "./OBadge.vue";
import { CHIP_TONES } from "./OBadge.types";
import { CHIP_TONE_CLASSES } from "./chipClasses";

const DOT = "size-1.5";

describe("OBadge", () => {
  it("renders default slot content in a span", () => {
    const w = mount(OBadge, { slots: { default: "Firing" } });
    expect(w.element.tagName).toBe("SPAN");
    expect(w.text()).toBe("Firing");
  });

  it("is a 20 px chip with radius 4, 12 px medium text by default", () => {
    const cls = mount(OBadge).classes();
    expect(cls).toEqual(expect.arrayContaining(["h-5", "rounded-chip", "text-xs", "font-medium"]));
  });

  it("md is the 24 px control height", () => {
    expect(mount(OBadge, { props: { size: "md" } }).classes()).toContain("h-control-xs");
  });

  it("renders every tone's triplet classes", () => {
    for (const tone of CHIP_TONES) {
      const cls = mount(OBadge, { props: { tone } }).classes();
      for (const c of CHIP_TONE_CLASSES[tone].split(" ")) expect(cls, tone).toContain(c);
    }
  });

  it("gives a status tone an automatic dot", () => {
    for (const tone of ["ok", "warn", "err", "crit", "info"] as const) {
      expect(mount(OBadge, { props: { tone } }).html().includes(DOT), tone).toBe(true);
    }
  });

  it("gives neutral, outline and accent no automatic dot", () => {
    for (const tone of ["neutral", "outline", "accent"] as const) {
      expect(mount(OBadge, { props: { tone } }).html().includes(DOT), tone).toBe(false);
    }
  });

  it("skips the automatic dot when an icon carries the status", () => {
    const w = mount(OBadge, { props: { tone: "err", icon: "warning" } });
    expect(w.html().includes(DOT)).toBe(false);
  });

  it("honours an explicit dot either way", () => {
    expect(
      mount(OBadge, { props: { tone: "ok", dot: false } })
        .html()
        .includes(DOT),
    ).toBe(false);
    expect(
      mount(OBadge, { props: { dot: true } })
        .html()
        .includes(DOT),
    ).toBe(true);
  });

  it("renders the #icon slot over the icon prop", () => {
    const w = mount(OBadge, {
      props: { icon: "check" },
      slots: { icon: '<span class="custom-icon" />' },
    });
    expect(w.find(".custom-icon").exists()).toBe(true);
  });

  it("renders a legacy icon name as an aria-hidden glyph", () => {
    const w = mount(OBadge, { props: { icon: "not_a_registry_icon" } });
    expect(w.find(".material-icons-outlined").attributes("aria-hidden")).toBe("true");
  });

  it("renders the #trailing slot after a divider", () => {
    const w = mount(OBadge, { slots: { default: "Errors", trailing: "12" } });
    expect(w.find(".border-s").text()).toBe("12");
  });

  it("mono sets the monospace face", () => {
    expect(mount(OBadge, { props: { mono: true } }).classes()).toContain("font-mono");
  });

  it("mutes a disabled chip", () => {
    const w = mount(OBadge, { props: { disabled: true } });
    expect(w.classes()).toContain("opacity-40");
    expect(w.attributes("aria-disabled")).toBe("true");
  });
});

describe("OBadge toggle", () => {
  it("renders a 24 px button with aria-pressed", () => {
    const w = mount(OBadge, { props: { toggle: true, pressed: false } });
    expect(w.element.tagName).toBe("BUTTON");
    expect(w.attributes("type")).toBe("button");
    expect(w.attributes("aria-pressed")).toBe("false");
    expect(w.classes()).toContain("h-control-xs");
  });

  it("shows the accent look when pressed", () => {
    const w = mount(OBadge, { props: { toggle: true, pressed: true } });
    expect(w.attributes("aria-pressed")).toBe("true");
    expect(w.classes()).toContain("bg-badge-primary-soft-bg");
  });

  it("emits click when activated", async () => {
    const w = mount(OBadge, { props: { toggle: true } });
    await w.trigger("click");
    expect(w.emitted("click")).toHaveLength(1);
  });

  it("does not emit click when disabled", async () => {
    const w = mount(OBadge, { props: { toggle: true, disabled: true } });
    expect(w.attributes("disabled")).toBeDefined();
    await w.trigger("click");
    expect(w.emitted("click")).toBeUndefined();
  });

  it("never emits click from a plain chip", async () => {
    const w = mount(OBadge);
    await w.trigger("click");
    expect(w.emitted("click")).toBeUndefined();
  });

  it("has no automatic dot", () => {
    const w = mount(OBadge, { props: { toggle: true, tone: "err" } });
    expect(w.html().includes(DOT)).toBe(false);
  });

  it("keeps a status tone while unpressed, so a status chip that opens details stays readable", () => {
    const w = mount(OBadge, { props: { toggle: true, tone: "err" } });
    expect(w.classes()).toContain("bg-badge-error-soft-bg");
  });

  it("a removable toggle is a keyboard-reachable span with the button role", async () => {
    const w = mount(OBadge, { props: { toggle: true, removable: true }, attachTo: document.body });
    expect(w.element.tagName).toBe("SPAN");
    expect(w.attributes("role")).toBe("button");
    expect(w.attributes("tabindex")).toBe("0");
    await w.trigger("keydown", { key: "Enter" });
    expect(w.emitted("click")).toHaveLength(1);
    await w.find("[data-test='o2-badge-remove']").trigger("click");
    expect(w.emitted("remove")).toHaveLength(1);
    expect(w.emitted("click")).toHaveLength(1);
    w.unmount();
  });
});
