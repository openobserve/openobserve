import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OPagination from "./OPagination.vue";

const factory = (props = {}) =>
  mount(OPagination, { props: { modelValue: 1, max: 10, ...props } });

describe("OPagination", () => {
  it("renders a div element with role=navigation", () => {
    const wrapper = factory();
    expect(wrapper.element.tagName).toBe("DIV");
    expect(wrapper.attributes("role")).toBe("navigation");
  });

  it("passes through attrs to the root element", () => {
    const wrapper = factory({ "data-test": "pg" } as any);
    expect(wrapper.attributes("data-test")).toBe("pg");
  });

  // ─── Page window ────────────────────────────────────────────────────────────

  it("renders all pages when max <= maxPages", () => {
    const wrapper = factory({ modelValue: 1, max: 4 });
    const btns = wrapper.findAll("[aria-label^='Page']");
    expect(btns.map((b) => b.text())).toEqual(["1", "2", "3", "4"]);
  });

  it("renders maxPages=5 buttons when max > 5", () => {
    const wrapper = factory({ modelValue: 5, max: 20 });
    const btns = wrapper.findAll("[aria-label^='Page']");
    expect(btns).toHaveLength(5);
  });

  it("honours a custom maxPages prop", () => {
    const wrapper = factory({ modelValue: 5, max: 20, maxPages: 3 });
    const btns = wrapper.findAll("[aria-label^='Page']");
    expect(btns).toHaveLength(3);
  });

  it("centres window around current page", () => {
    const wrapper = factory({ modelValue: 8, max: 20, maxPages: 5 });
    const btns = wrapper.findAll("[aria-label^='Page']");
    expect(btns.map((b) => b.text())).toEqual(["6", "7", "8", "9", "10"]);
  });

  it("clamps window at the start", () => {
    const wrapper = factory({ modelValue: 2, max: 20, maxPages: 5 });
    const btns = wrapper.findAll("[aria-label^='Page']");
    expect(btns[0].text()).toBe("1");
    expect(btns).toHaveLength(5);
  });

  it("clamps window at the end", () => {
    const wrapper = factory({ modelValue: 20, max: 20, maxPages: 5 });
    const btns = wrapper.findAll("[aria-label^='Page']");
    expect(btns[btns.length - 1].text()).toBe("20");
    expect(btns).toHaveLength(5);
  });

  it("marks the active page with aria-current=page", () => {
    const wrapper = factory({ modelValue: 3, max: 10 });
    const active = wrapper.find("[aria-current='page']");
    expect(active.text()).toBe("3");
  });

  // ─── Navigation ─────────────────────────────────────────────────────────────

  it("emits update:modelValue when a page button is clicked", async () => {
    const wrapper = factory({ modelValue: 1, max: 10 });
    const page3 = wrapper.find("[aria-label='Page 3']");
    await page3.trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([3]);
  });

  it("emits next page on next button click", async () => {
    const wrapper = factory({ modelValue: 3, max: 10 });
    await wrapper.find("[aria-label='Next page']").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([4]);
  });

  it("emits prev page on prev button click", async () => {
    const wrapper = factory({ modelValue: 5, max: 10 });
    await wrapper.find("[aria-label='Previous page']").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([4]);
  });

  it("does not emit when clicking the active page button", async () => {
    const wrapper = factory({ modelValue: 3, max: 10 });
    await wrapper.find("[aria-current='page']").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  // ─── Boundary guards ────────────────────────────────────────────────────────

  it("prev button is disabled on page 1", () => {
    const wrapper = factory({ modelValue: 1, max: 10 });
    const prev = wrapper.find("[aria-label='Previous page']");
    expect(prev.attributes("disabled")).toBeDefined();
  });

  it("next button is disabled on the last page", () => {
    const wrapper = factory({ modelValue: 10, max: 10 });
    const next = wrapper.find("[aria-label='Next page']");
    expect(next.attributes("disabled")).toBeDefined();
  });

  // ─── Disabled state ──────────────────────────────────────────────────────────

  it("does not emit when disabled", async () => {
    const wrapper = factory({ modelValue: 3, max: 10, disable: true });
    await wrapper.find("[aria-label='Next page']").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  // ─── Edge cases ──────────────────────────────────────────────────────────────

  it("renders nothing when max is 0", () => {
    const wrapper = factory({ modelValue: 1, max: 0 });
    expect(wrapper.findAll("[aria-label^='Page']")).toHaveLength(0);
  });

  it("renders a single page button when max is 1", () => {
    const wrapper = factory({ modelValue: 1, max: 1 });
    expect(wrapper.findAll("[aria-label^='Page']")).toHaveLength(1);
  });
});
