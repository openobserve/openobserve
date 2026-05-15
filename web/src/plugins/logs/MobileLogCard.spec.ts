import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import MobileLogCard from "./MobileLogCard.vue";

describe("MobileLogCard", () => {
  const baseRow = {
    _timestamp: Date.now() * 1000, // microseconds
    log: "Connection refused to database host db-primary.internal:5432",
    level: "error",
  };

  it("renders timestamp and message", () => {
    const wrapper = mount(MobileLogCard, {
      props: { row: baseRow, index: 0 },
    });

    expect(wrapper.find(".mobile-log-card__timestamp").text()).toContain("ago");
    expect(wrapper.find(".mobile-log-card__body").text()).toContain(
      "Connection refused",
    );
  });

  it("shows severity label when present", () => {
    const wrapper = mount(MobileLogCard, {
      props: { row: baseRow, index: 0 },
    });

    expect(wrapper.find(".mobile-log-card__severity").text()).toBe("ERROR");
  });

  it("applies severity class for error level", () => {
    const wrapper = mount(MobileLogCard, {
      props: { row: baseRow, index: 0 },
    });

    expect(wrapper.classes()).toContain("mobile-log-card--error");
  });

  it("applies warn class for warning level", () => {
    const wrapper = mount(MobileLogCard, {
      props: { row: { ...baseRow, level: "warning" }, index: 0 },
    });

    expect(wrapper.classes()).toContain("mobile-log-card--warn");
  });

  it("truncates long messages at 120 chars", () => {
    const longMsg = "x".repeat(200);
    const wrapper = mount(MobileLogCard, {
      props: { row: { ...baseRow, log: longMsg }, index: 0 },
    });

    const body = wrapper.find(".mobile-log-card__body").text();
    expect(body.length).toBeLessThanOrEqual(120);
    expect(body).toContain("...");
  });

  it("emits click with row and index", async () => {
    const wrapper = mount(MobileLogCard, {
      props: { row: baseRow, index: 3 },
    });

    await wrapper.trigger("click");

    expect(wrapper.emitted("click")).toBeTruthy();
    expect(wrapper.emitted("click")![0]).toEqual([baseRow, 3]);
  });

  it("hides severity badge when level is absent", () => {
    const row = { _timestamp: Date.now() * 1000, log: "some message" };
    const wrapper = mount(MobileLogCard, {
      props: { row, index: 0 },
    });

    expect(wrapper.find(".mobile-log-card__severity").exists()).toBe(false);
  });

  it("falls back to first non-timestamp field when no known message field", () => {
    const row = {
      _timestamp: Date.now() * 1000,
      custom_field: "fallback value here",
    };
    const wrapper = mount(MobileLogCard, {
      props: { row, index: 0 },
    });

    expect(wrapper.find(".mobile-log-card__body").text()).toContain(
      "fallback value here",
    );
  });

  it("bounds the JSON fallback to a small key sample for wide rows", () => {
    // Row with only underscore/timestamp-prefixed keys forces the last-resort
    // JSON.stringify path. Hundreds of fields shouldn't balloon the output —
    // the body truncates at 120 chars regardless of row size.
    const row: Record<string, string> = { _timestamp: Date.now() * 1000 };
    for (let i = 0; i < 500; i++) row[`_field_${i}`] = `value-${i}`;
    const wrapper = mount(MobileLogCard, {
      props: { row, index: 0 },
    });

    const text = wrapper.find(".mobile-log-card__body").text();
    expect(text.length).toBeLessThanOrEqual(120);
  });

  it("renders empty body when row prop is falsy", () => {
    const wrapper = mount(MobileLogCard, {
      // Vue prop validation won't block this — we just guard at runtime.
      props: { row: null as any, index: 0 },
    });

    expect(wrapper.find(".mobile-log-card__body").text()).toBe("");
  });

  it("handles future timestamps gracefully", () => {
    const futureTs = (Date.now() + 60000) * 1000; // 1 minute in the future (microseconds)
    const wrapper = mount(MobileLogCard, {
      props: { row: { ...baseRow, _timestamp: futureTs }, index: 0 },
    });

    // Should show formatted date instead of negative relative time
    const text = wrapper.find(".mobile-log-card__timestamp").text();
    expect(text).not.toContain("-");
    expect(text).not.toContain("ago");
  });

  it("handles nanosecond timestamps", () => {
    const nsTs = Date.now() * 1e6; // nanoseconds
    const wrapper = mount(MobileLogCard, {
      props: { row: { ...baseRow, _timestamp: nsTs }, index: 0 },
    });

    expect(wrapper.find(".mobile-log-card__timestamp").text()).toContain("ago");
  });

  it("emits click on Enter keydown", async () => {
    const wrapper = mount(MobileLogCard, {
      props: { row: baseRow, index: 0 },
    });

    await wrapper.trigger("keydown.enter");

    expect(wrapper.emitted("click")).toBeTruthy();
    expect(wrapper.emitted("click")![0]).toEqual([baseRow, 0]);
  });
});
