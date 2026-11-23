// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { raw } from "@/types/i18n";
import OCard from "./OCard.vue";

describe("OCard", () => {
  it("draws one frame: 1 px border, radius 10, surface fill, no shadow", () => {
    const classes = mount(OCard).classes();
    expect(classes).toEqual(
      expect.arrayContaining([
        "border",
        "border-border-default",
        "rounded-surface",
        "bg-surface-base",
        "overflow-hidden",
      ]),
    );
    expect(classes.some((c) => /^shadow/.test(c))).toBe(false);
  });

  it("renders slot content in a padded body", () => {
    const wrapper = mount(OCard, { slots: { default: "<p>Hello</p>" } });
    const body = wrapper.get('[data-test="o-card-body"]');
    expect(body.html()).toContain("<p>Hello</p>");
    expect(body.classes()).toEqual(expect.arrayContaining(["p-3", "text-compact"]));
  });

  it("drops the body padding when flush", () => {
    const body = mount(OCard, { props: { flush: true } }).get('[data-test="o-card-body"]');
    expect(body.classes()).not.toContain("p-3");
  });

  it("hides the header without a title", () => {
    expect(mount(OCard).find('[data-test="o-card-header"]').exists()).toBe(false);
  });

  it("shows a 40 px header with title, meta and actions", () => {
    const wrapper = mount(OCard, {
      props: { title: raw("Requests by status"), meta: raw("last 1 hour") },
      slots: { actions: "<button>Rate</button>" },
    });
    const header = wrapper.get('[data-test="o-card-header"]');
    expect(header.classes()).toEqual(expect.arrayContaining(["h-10", "border-b"]));
    expect(header.get("h3").text()).toBe("Requests by status");
    expect(header.get("h3").classes()).toEqual(
      expect.arrayContaining(["text-compact", "font-semibold", "text-text-heading"]),
    );
    expect(header.text()).toContain("last 1 hour");
    expect(header.text()).toContain("Rate");
  });

  it("renders a custom header line from the header slot", () => {
    const wrapper = mount(OCard, { slots: { header: "<span>Custom</span>" } });
    expect(wrapper.get('[data-test="o-card-header"]').text()).toBe("Custom");
  });

  it("renders a right-aligned footer", () => {
    const wrapper = mount(OCard, { slots: { footer: "<button>Save</button>" } });
    const footer = wrapper.get('[data-test="o-card-footer"]');
    expect(footer.classes()).toContain("justify-end");
    expect(footer.text()).toBe("Save");
  });

  it("keeps the frame and header while loading, with a skeleton body", () => {
    const wrapper = mount(OCard, {
      props: { title: raw("Ingestion"), loading: true },
      slots: { default: "<p>Loaded</p>" },
    });
    expect(wrapper.find('[data-test="o-card-header"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o-card-skeleton"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Loaded");
    expect(wrapper.attributes("aria-busy")).toBe("true");
  });

  it("forwards class and data-test via attrs", () => {
    const wrapper = mount(OCard, { attrs: { class: "w-full", "data-test": "my-card" } });
    expect(wrapper.classes()).toContain("w-full");
    expect(wrapper.attributes("data-test")).toBe("my-card");
  });
});
