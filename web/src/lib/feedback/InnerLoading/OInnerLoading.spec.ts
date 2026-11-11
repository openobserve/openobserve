import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import OInnerLoading from "./OInnerLoading.vue";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";

// Hidden while any element from it up to the overlay root carries opacity-0.
function isHidden(el: Element, root: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.classList.contains("opacity-0")) return true;
    if (node === root) return false;
  }
  return false;
}

describe("OInnerLoading", () => {
  it("does not render when showing=false", () => {
    const wrapper = mount(OInnerLoading, { props: { showing: false } });
    expect(wrapper.find("[role='status']").exists()).toBe(false);
  });

  it("renders overlay when showing=true", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true },
      global: { stubs: { transition: false } },
    });
    expect(wrapper.find("[role='status']").exists()).toBe(true);
  });

  it("renders OSpinner inside the overlay", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true },
      global: { stubs: { transition: false } },
    });
    expect(wrapper.findComponent({ name: "OSpinner" }).exists()).toBe(true);
  });

  it("renders label text when label prop is provided", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true, label: "Fetching values..." },
      global: { stubs: { transition: false } },
    });
    expect(wrapper.text()).toContain("Fetching values...");
  });

  it("does not render label span when no label prop", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true },
      global: { stubs: { transition: false } },
    });
    expect(wrapper.find("span.text-xs.text-inner-loading-label").exists()).toBe(false);
  });

  it("sets aria-label to label text when provided", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true, label: "Fetching values..." },
      global: { stubs: { transition: false } },
    });
    expect(wrapper.find("[role='status']").attributes("aria-label")).toBe("Fetching values...");
  });

  it("defaults aria-label to 'Loading' when no label", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true },
      global: { stubs: { transition: false } },
    });
    expect(wrapper.find("[role='status']").attributes("aria-label")).toBe("Loading");
  });

  it("applies absolute+inset-0 overlay positioning", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true },
      global: { stubs: { transition: false } },
    });
    const overlay = wrapper.find("[role='status']");
    expect(overlay.classes()).toContain("absolute");
    expect(overlay.classes()).toContain("inset-0");
  });

  it("keeps the scrim and spinner invisible until the delay passes, with the real Transition", async () => {
    vi.useFakeTimers();
    const wrapper = mount(OInnerLoading, {
      props: { showing: false },
      global: { stubs: { transition: false } },
    });
    try {
      await wrapper.setProps({ showing: true });
      const root = wrapper.get("[role='status']").element;
      const scrim = wrapper.get(".bg-inner-loading-overlay").element;
      const spinner = wrapper.getComponent({ name: "OSpinner" }).element as Element;

      await vi.advanceTimersByTimeAsync(100);
      await nextTick();
      expect(isHidden(scrim, root)).toBe(true);
      expect(isHidden(spinner, root)).toBe(true);

      await vi.advanceTimersByTimeAsync(LOADER_DELAY_MS - 101);
      await nextTick();
      expect(isHidden(scrim, root)).toBe(true);
      expect(isHidden(spinner, root)).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await nextTick();
      expect(isHidden(scrim, root)).toBe(false);
      expect(isHidden(spinner, root)).toBe(false);
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });
});
