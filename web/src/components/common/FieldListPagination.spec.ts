// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import FieldListPagination from "./FieldListPagination.vue";

const BASE = {
  currentPage: 1,
  pagesNumber: 1,
  isFirstPage: true,
  isLastPage: true,
  totalFieldsCount: 12,
};

describe("FieldListPagination", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders the reset control as a real button with an accessible name", async () => {
    wrapper = mount(FieldListPagination, { props: BASE });
    const reset = wrapper.find('[data-test="logs-page-fields-list-reset-icon"]');
    expect(reset.element.tagName).toBe("BUTTON");
    expect(reset.attributes("aria-label")).toBeTruthy();
    await reset.trigger("click");
    expect(wrapper.emitted("reset-fields")).toHaveLength(1);
  });

  it("hides the reset control for pages without table columns", () => {
    wrapper = mount(FieldListPagination, { props: { ...BASE, showReset: false } });
    expect(wrapper.find('[data-test="logs-page-fields-list-reset-icon"]').exists()).toBe(false);
  });

  it("shows the pager only when there is more than one page", async () => {
    wrapper = mount(FieldListPagination, { props: BASE });
    expect(
      wrapper.find('[data-test="logs-page-fields-list-pagination-firstpage-button"]').exists(),
    ).toBe(false);
    await wrapper.setProps({ pagesNumber: 3, isLastPage: false });
    expect(
      wrapper.find('[data-test="logs-page-fields-list-pagination-page-3-button"]').exists(),
    ).toBe(true);
    await wrapper
      .find('[data-test="logs-page-fields-list-pagination-page-2-button"]')
      .trigger("click");
    expect(wrapper.emitted("set-page")?.[0]).toEqual([2]);
  });

  it("prefixes every control id with the page's prefix", () => {
    wrapper = mount(FieldListPagination, {
      props: { ...BASE, dataTestPrefix: "traces-page", pagesNumber: 2, isLastPage: false },
    });
    expect(
      wrapper.find('[data-test="traces-page-fields-list-pagination-lastpage-button"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="traces-page-fields-list-reset-icon"]').exists()).toBe(true);
  });

  it("shows no always-visible field count, on one page or many", async () => {
    wrapper = mount(FieldListPagination, { props: { ...BASE, totalFieldsCount: 12 } });
    expect(wrapper.text()).not.toContain("12");
    await wrapper.setProps({ pagesNumber: 3, isLastPage: false, totalFieldsCount: 102 });
    expect(wrapper.text()).not.toContain("102");
  });

  it("keeps the total in the pager's tooltip", () => {
    wrapper = mount(FieldListPagination, {
      props: { ...BASE, pagesNumber: 3, isLastPage: false, totalFieldsCount: 102 },
    });
    const tooltips = wrapper.findAllComponents({ name: "OTooltip" });
    expect(tooltips.some((tip) => String(tip.props("content")).includes("102"))).toBe(true);
  });
});
