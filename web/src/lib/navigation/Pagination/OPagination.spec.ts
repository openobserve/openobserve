import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OPagination from "./OPagination.vue";

const factory = (props: Record<string, unknown> = {}) =>
  mount(OPagination, {
    props: { page: 1, pageSize: 20, total: 143, ...props },
    attrs: { "data-test": "pg" },
  });

const button = (wrapper: ReturnType<typeof factory>, part: string) =>
  wrapper.find(`[data-test="pg-${part}"]`);

describe("OPagination", () => {
  it("renders one navigation landmark carrying the caller's attrs", () => {
    const wrapper = factory();
    expect(wrapper.element.tagName).toBe("NAV");
    expect(wrapper.attributes("data-test")).toBe("pg");
  });

  // ─── Range ──────────────────────────────────────────────────────────────────

  it('states the range as "1–20 of 143"', () => {
    expect(button(factory(), "range").text()).toBe("1–20 of 143");
    expect(button(factory({ page: 8 }), "range").text()).toBe("141–143 of 143");
  });

  it('reads "of many" for a lower-bound total', () => {
    expect(button(factory({ totalExact: false }), "range").text()).toBe("1–20 of many");
  });

  it('reads "Page 4 of 31" when only the page count is known', () => {
    const wrapper = factory({ page: 4, total: undefined, pageCount: 31 });
    expect(button(wrapper, "range").text()).toBe("Page 4 of 31");
  });

  it("lets a caller replace the range", () => {
    const wrapper = mount(OPagination, {
      props: { page: 1, total: 10 },
      slots: { range: "<span data-test='own-range'>own</span>" },
    });
    expect(wrapper.find('[data-test="own-range"]').exists()).toBe(true);
  });

  // ─── Paging ─────────────────────────────────────────────────────────────────

  it("emits the next and previous page", async () => {
    const wrapper = factory({ page: 3 });
    await button(wrapper, "next").trigger("click");
    await button(wrapper, "prev").trigger("click");
    expect(wrapper.emitted("update:page")).toEqual([[4], [2]]);
  });

  it("disables previous on the first page and next on the last, with a reason", () => {
    const first = factory({ page: 1 });
    expect(button(first, "prev").attributes("aria-disabled")).toBe("true");
    expect(button(first, "next").attributes("aria-disabled")).toBeUndefined();
    const last = factory({ page: 8 });
    expect(button(last, "next").attributes("aria-disabled")).toBe("true");
  });

  it("shows first and last only past ten pages", async () => {
    expect(button(factory(), "first").exists()).toBe(false);
    const long = factory({ page: 5, total: 1000 });
    expect(button(long, "first").exists()).toBe(true);
    await button(long, "last").trigger("click");
    await button(long, "first").trigger("click");
    expect(long.emitted("update:page")).toEqual([[50], [1]]);
  });

  it("omits last page when the total is a lower bound", () => {
    const wrapper = factory({ page: 5, total: 1000, totalExact: false });
    expect(button(wrapper, "first").exists()).toBe(true);
    expect(button(wrapper, "last").exists()).toBe(false);
  });

  it("ignores paging while loading but keeps the range", async () => {
    const wrapper = factory({ page: 3, loading: true });
    await button(wrapper, "next").trigger("click");
    expect(wrapper.emitted("update:page")).toBeUndefined();
    expect(button(wrapper, "next").attributes("aria-disabled")).toBe("true");
    expect(button(wrapper, "range").text()).toBe("41–60 of 143");
  });

  // ─── Page size ──────────────────────────────────────────────────────────────

  it("renders the page-size select only with page sizes", () => {
    expect(button(factory(), "size").exists()).toBe(false);
    expect(button(factory({ pageSizes: [20, 50, 100] }), "size").exists()).toBe(true);
  });

  it("puts every control at the sm height (S8)", () => {
    const wrapper = factory({ pageSizes: [20, 50, 100] });
    const select = wrapper.findComponent({ name: "OSelect" });
    expect(select.props("size")).toBe("sm");
    for (const b of wrapper.findAllComponents({ name: "OButton" })) {
      expect(b.props("size")).toBe("sm");
    }
  });

  it("lists a configured size outside the choices so the select never reads blank", () => {
    const wrapper = factory({ pageSizes: [20, 50, 100], pageSize: 25 });
    const options = wrapper.findComponent({ name: "OSelect" }).props("options") as {
      value: number;
    }[];
    expect(options.map((o) => o.value)).toEqual([20, 25, 50, 100]);
  });

  it("emits a new page size", async () => {
    const wrapper = factory({ pageSizes: [20, 50, 100] });
    wrapper.findComponent({ name: "OSelect" }).vm.$emit("update:modelValue", 50);
    expect(wrapper.emitted("update:pageSize")).toEqual([[50]]);
  });

  it("names its parts by the explicit test ids when given", () => {
    const wrapper = mount(OPagination, {
      props: { page: 1, total: 50, testIds: { next: "table-next", range: "table-range" } },
    });
    expect(wrapper.find('[data-test="table-next"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="table-range"]').text()).toBe("1–20 of 50");
  });
});
