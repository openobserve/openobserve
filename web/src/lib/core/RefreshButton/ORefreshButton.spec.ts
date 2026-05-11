import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import ORefreshButton from "./ORefreshButton.vue";

// Stub OButton to avoid rendering its internals
const stubs = {
  OButton: { template: '<button v-bind="$attrs"><slot /></button>' },
};

describe("ORefreshButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Default rendering ---

  it("renders the refresh button", () => {
    const wrapper = mount(ORefreshButton, { global: { stubs } });
    expect(wrapper.find('[data-test="refresh-button"]').exists()).toBe(true);
  });

  it("does not render a timestamp span when lastRunAt is not provided", () => {
    const wrapper = mount(ORefreshButton, { global: { stubs } });
    expect(wrapper.find("span.tw\:tabular-nums").exists()).toBe(false);
  });

  it("renders a timestamp span when lastRunAt is provided", () => {
    const ts = Date.now() - 10_000;
    const wrapper = mount(ORefreshButton, {
      props: { lastRunAt: ts },
      global: { stubs },
    });
    expect(wrapper.find("span.tw\\:tabular-nums").exists()).toBe(true);
  });

  // --- dot color classes ---

  it("uses idle dot color when no lastRunAt", () => {
    const wrapper = mount(ORefreshButton, { global: { stubs } });
    const dot = wrapper.find(".tw\\:rounded-full");
    expect(dot.classes()).toContain("tw:bg-refresh-dot-idle");
  });

  it("uses fresh dot color when lastRunAt < 30s ago", () => {
    const wrapper = mount(ORefreshButton, {
      props: { lastRunAt: Date.now() - 5_000 },
      global: { stubs },
    });
    const dot = wrapper.find(".tw\\:rounded-full");
    expect(dot.classes()).toContain("tw:bg-refresh-dot-fresh");
  });

  it("uses stale dot color when lastRunAt is 30s–5min ago", () => {
    const wrapper = mount(ORefreshButton, {
      props: { lastRunAt: Date.now() - 60_000 },
      global: { stubs },
    });
    const dot = wrapper.find(".tw\\:rounded-full");
    expect(dot.classes()).toContain("tw:bg-refresh-dot-stale");
  });

  it("uses critical dot color when lastRunAt > 5min ago", () => {
    const wrapper = mount(ORefreshButton, {
      props: { lastRunAt: Date.now() - 400_000 },
      global: { stubs },
    });
    const dot = wrapper.find(".tw\\:rounded-full");
    expect(dot.classes()).toContain("tw:bg-refresh-dot-critical");
  });

  it("uses idle dot color when loading=true regardless of lastRunAt", () => {
    const wrapper = mount(ORefreshButton, {
      props: { lastRunAt: Date.now() - 5_000, loading: true },
      global: { stubs },
    });
    const dot = wrapper.find(".tw\\:rounded-full");
    expect(dot.classes()).toContain("tw:bg-refresh-dot-idle");
  });

  // --- emits ---

  it("emits click when button is clicked", async () => {
    const wrapper = mount(ORefreshButton, { global: { stubs } });
    await wrapper.find('[data-test="refresh-button"]').trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  it("does not emit click when loading=true", async () => {
    const wrapper = mount(ORefreshButton, {
      props: { loading: true },
      global: { stubs },
    });
    await wrapper.find('[data-test="refresh-button"]').trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  it("does not emit click when disabled=true", async () => {
    const wrapper = mount(ORefreshButton, {
      props: { disabled: true },
      global: { stubs },
    });
    await wrapper.find('[data-test="refresh-button"]').trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });
});
