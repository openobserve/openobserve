// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import LoadingProgress from "./LoadingProgress.vue";
import source from "./LoadingProgress.vue?raw";
import { createStore } from "vuex";

describe("LoadingProgress", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
      },
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should render the component", () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 50,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should display progress bar when loading", () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 50,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.html()).toContain("w-full");
  });

  it("should set minimum width of 5% for very small percentages", () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 2,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.vm.displayPercentage).toBe(5);
  });

  it("should display actual percentage when greater than 5%", () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 75,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.vm.displayPercentage).toBe(75);
  });

  it("should reach 100% when loading completes", async () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 80,
      },
      global: {
        plugins: [store],
      },
    });

    await wrapper.setProps({ loading: false });
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.displayPercentage).toBe(100);
  });

  it("should fade out after loading completes", async () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 80,
      },
      global: {
        plugins: [store],
      },
    });

    await wrapper.setProps({ loading: false });
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.isFadingOut).toBe(true);
  });

  it("should reset to 0% after fade out completes", async () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 80,
      },
      global: {
        plugins: [store],
      },
    });

    await wrapper.setProps({ loading: false });
    await wrapper.vm.$nextTick();

    // Fast-forward time by 500ms (fade out duration)
    vi.advanceTimersByTime(500);
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.isFadingOut).toBe(false);
    expect(wrapper.vm.displayPercentage).toBe(0);
  });

  it("should validate percentage is between 0 and 100", () => {
    const validator = LoadingProgress.props.loadingProgressPercentage.validator;

    expect(validator(0)).toBe(true);
    expect(validator(50)).toBe(true);
    expect(validator(100)).toBe(true);
    expect(validator(-1)).toBe(false);
    expect(validator(101)).toBe(false);
  });

  it("should apply opacity-0 class when not loading and not fading", () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: false,
        loadingProgressPercentage: 0,
      },
      global: {
        plugins: [store],
      },
    });

    const container = wrapper.find(".absolute");
    expect(container.classes()).toContain("opacity-0");
  });

  it("should apply opacity-100 class when loading", () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 50,
      },
      global: {
        plugins: [store],
      },
    });

    const container = wrapper.find(".absolute");
    expect(container.classes()).toContain("opacity-100");
  });

  it("should use dark theme colors when theme is dark", () => {
    const darkStore = createStore({
      state: {
        theme: "dark",
      },
    });

    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 50,
      },
      global: {
        plugins: [darkStore],
      },
    });

    expect(wrapper.html()).toContain("bg-progress-bar-track");
  });

  it("should use light theme colors when theme is light", () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 50,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.html()).toContain("bg-progress-bar-track");
  });

  it("should show shimmer animation during loading", () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 50,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.html()).toContain("shimmer");
  });

  it("should update percentage when prop changes", async () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 30,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.vm.displayPercentage).toBe(30);

    await wrapper.setProps({ loadingProgressPercentage: 70 });
    expect(wrapper.vm.displayPercentage).toBe(70);
  });

  it("should have moving circle indicator", () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 50,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.html()).toContain("absolute top-0");
    expect(wrapper.html()).toContain("rounded-full");
  });

  it("should have smooth transition animation", () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 50,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.html()).toContain("cubic-bezier");
  });

  it("should position at top of container with z-index", () => {
    const wrapper = mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 50,
      },
      global: {
        plugins: [store],
      },
    });

    const container = wrapper.find(".absolute");
    expect(container.classes()).toContain("top-0");
    expect(container.classes()).toContain("z-999");
  });

  it("keeps only the line itself moving under reduced motion, slowed by the shared factor", () => {
    const wrapper = mount(LoadingProgress, {
      props: { loading: true, loadingProgressPercentage: 50 },
      global: { plugins: [store] },
    });
    const kept = wrapper.findAll(".o2-motion-keep");
    expect(kept).toHaveLength(2);
    for (const el of kept) {
      expect(el.attributes("style")).toContain("calc(0.3s * var(--motion-slowdown))");
    }
    expect(wrapper.find(".loading-progress__shimmer").classes()).not.toContain("o2-motion-keep");
    expect(wrapper.find(".loading-progress__head-glow").classes()).not.toContain("o2-motion-keep");
  });
  describe("determinate value (opt-in)", () => {
    const widthOf = (wrapper: any) =>
      (wrapper.find(".o2-motion-keep").element as HTMLElement).style.width;

    it("keeps the base indeterminate look and no progressbar role when value and label are absent", () => {
      const wrapper = mount(LoadingProgress, {
        props: { loading: true, loadingProgressPercentage: 40 },
        global: { plugins: [store] },
      });
      expect(wrapper.find(".loading-progress__shimmer").exists()).toBe(true);
      expect(wrapper.find(".loading-progress__head-glow").exists()).toBe(true);
      expect(wrapper.attributes("role")).toBeUndefined();
      expect(widthOf(wrapper)).toBe("40%");
    });

    it("drops the shimmer and head glow and follows value", () => {
      const wrapper = mount(LoadingProgress, {
        props: { loading: true, loadingProgressPercentage: 0, value: 30 },
        global: { plugins: [store] },
      });
      expect(wrapper.find(".loading-progress__shimmer").exists()).toBe(false);
      expect(wrapper.find(".loading-progress__head-glow").exists()).toBe(false);
      expect(widthOf(wrapper)).toBe("30%");
    });

    it("never moves back within a run, and starts again on the next run", async () => {
      const wrapper = mount(LoadingProgress, {
        props: { loading: true, loadingProgressPercentage: 0, value: 60 },
        global: { plugins: [store] },
      });
      await wrapper.setProps({ value: 20 });
      expect(widthOf(wrapper)).toBe("60%");
      await wrapper.setProps({ loading: false });
      vi.advanceTimersByTime(600);
      await wrapper.setProps({ loading: true, value: 10 });
      expect(widthOf(wrapper)).toBe("10%");
    });

    it("is a named progressbar with its value when a label is given", () => {
      const wrapper = mount(LoadingProgress, {
        props: {
          loading: true,
          loadingProgressPercentage: 0,
          value: 25,
          label: "Loading spans…",
          valueText: "25%",
        },
        global: { plugins: [store] },
      });
      expect(wrapper.attributes("role")).toBe("progressbar");
      expect(wrapper.attributes("aria-label")).toBe("Loading spans…");
      expect(wrapper.attributes("aria-valuenow")).toBe("25");
      expect(wrapper.attributes("aria-valuetext")).toBe("25%");
    });
  });

  describe("bar colour", () => {
    const mountLine = (props: Record<string, unknown>) =>
      mount(LoadingProgress, {
        props: { loading: true, loadingProgressPercentage: 40, ...props },
        global: { plugins: [store] },
      });

    it("draws the bar and head in the fixed indigo (L-36)", () => {
      const wrapper = mountLine({});
      expect(wrapper.findAll(".bg-brand-indigo")).toHaveLength(2);
      expect(wrapper.find(".ring-brand-indigo\\/50").exists()).toBe(true);
      expect(wrapper.find(".bg-accent").exists()).toBe(false);
    });
  });

  describe("indeterminate (opt-in)", () => {
    const mountLine = (props: Record<string, unknown>) =>
      mount(LoadingProgress, {
        props: { loading: true, loadingProgressPercentage: 0, ...props },
        global: { plugins: [store] },
      });
    const travel = (wrapper: any) => wrapper.find('[data-test="loading-progress-travel"]');

    it("keeps the base 5% stub with its shimmer when indeterminate is not set (L-36)", () => {
      const wrapper = mountLine({});
      expect(wrapper.props("indeterminate")).toBe(false);
      expect(travel(wrapper).exists()).toBe(false);
      expect(wrapper.vm.displayPercentage).toBe(5);
      expect(wrapper.find(".loading-progress__shimmer").exists()).toBe(true);
      expect(wrapper.find(".loading-progress__head-glow").exists()).toBe(true);
      expect(wrapper.findAll(".o2-motion-keep")).toHaveLength(2);
      expect(wrapper.find(".bg-brand-indigo").exists()).toBe(true);
    });

    it("draws one travelling segment instead of the stub, kept moving under reduced motion", () => {
      const wrapper = mountLine({ indeterminate: true });
      const segment = travel(wrapper);
      expect(segment.exists()).toBe(true);
      expect(segment.classes()).toEqual(
        expect.arrayContaining([
          "o2-motion-keep",
          "loading-progress__travel",
          "bg-accent",
          "w-1/3",
        ]),
      );
      expect(wrapper.findAll(".o2-motion-keep")).toHaveLength(1);
      expect(wrapper.find(".loading-progress__shimmer").exists()).toBe(false);
      expect(wrapper.find(".rounded-full").exists()).toBe(false);
      expect(wrapper.find(".bg-progress-bar-track").exists()).toBe(true);
    });

    it("travels on the shared motion slowdown, so reduced motion runs it 4x slower", () => {
      const rule = source.match(/\.loading-progress__travel\s*\{([^}]*)\}/)?.[1] ?? "";
      expect(rule).toContain("animation: travel calc(1.5s * var(--motion-slowdown))");
      expect(rule).toContain("infinite");
      expect(source).toMatch(/@keyframes travel\s*\{/);
    });

    it("is a named progressbar with no value when labelled", () => {
      const wrapper = mountLine({ indeterminate: true, label: "Loading charts…" });
      expect(wrapper.attributes("role")).toBe("progressbar");
      expect(wrapper.attributes("aria-label")).toBe("Loading charts…");
      expect(wrapper.attributes("aria-valuenow")).toBeUndefined();
      expect(wrapper.attributes("aria-hidden")).toBeUndefined();
    });

    it("fades the segment out where it is, never filling the track, and stops it once hidden", async () => {
      const wrapper = mountLine({ indeterminate: true, label: "Loading charts…" });
      await wrapper.setProps({ loading: false });
      expect(travel(wrapper).exists()).toBe(true);
      expect(wrapper.find(".bg-brand-indigo").exists()).toBe(false);
      expect(wrapper.attributes("aria-hidden")).toBe("true");
      vi.advanceTimersByTime(500);
      await wrapper.vm.$nextTick();
      expect(travel(wrapper).exists()).toBe(false);
      expect(wrapper.classes()).toContain("opacity-0");
      await wrapper.setProps({ loading: true });
      expect(travel(wrapper).exists()).toBe(true);
    });

    it("fades the same segment out on its path and never swaps in the indigo bar or head", async () => {
      const wrapper = mountLine({ indeterminate: true });
      const segment = travel(wrapper).element;
      await wrapper.setProps({ loading: false });
      const defaultParts = () =>
        wrapper.findAll(".bg-brand-indigo").length + wrapper.findAll(".rounded-full").length;
      let elapsed = 0;
      for (const at of [0, 100, 250, 400, 499]) {
        vi.advanceTimersByTime(at - elapsed);
        elapsed = at;
        await wrapper.vm.$nextTick();
        expect(wrapper.classes()).toContain("opacity-0");
        expect(wrapper.classes()).toContain("transition-opacity");
        expect(travel(wrapper).element).toBe(segment);
        expect(defaultParts()).toBe(0);
      }
      vi.advanceTimersByTime(1);
      await wrapper.vm.$nextTick();
      expect(travel(wrapper).exists()).toBe(false);
      expect(defaultParts()).toBe(0);
      vi.advanceTimersByTime(2000);
      await wrapper.vm.$nextTick();
      expect(defaultParts()).toBe(0);
    });

    it("ends invisible when runs start and end in quick succession, whatever each run's mode", async () => {
      const wrapper = mountLine({ indeterminate: true, value: 40 });
      const defaultParts = () =>
        wrapper.findAll(".bg-brand-indigo").length + wrapper.findAll(".rounded-full").length;
      await wrapper.setProps({ loading: false });
      vi.advanceTimersByTime(350);
      await wrapper.setProps({ loading: true, value: undefined });
      vi.advanceTimersByTime(50);
      await wrapper.setProps({ loading: false });
      expect(wrapper.classes()).toContain("opacity-0");
      expect(defaultParts()).toBe(0);
      vi.advanceTimersByTime(100);
      await wrapper.setProps({ loading: true });
      vi.advanceTimersByTime(50);
      await wrapper.setProps({ loading: false });
      vi.advanceTimersByTime(2500);
      await wrapper.vm.$nextTick();
      expect(wrapper.classes()).toContain("opacity-0");
      expect(wrapper.classes()).not.toContain("opacity-100");
      expect(travel(wrapper).exists()).toBe(false);
      expect(defaultParts()).toBe(0);
    });

    it("leaves no hidden segment behind when a determinate run ends during the segment's fade", async () => {
      const wrapper = mountLine({ indeterminate: true });
      await wrapper.setProps({ loading: false });
      vi.advanceTimersByTime(200);
      await wrapper.setProps({ loading: true, value: 30 });
      vi.advanceTimersByTime(50);
      await wrapper.setProps({ loading: false });
      vi.advanceTimersByTime(2500);
      await wrapper.setProps({ value: undefined });
      expect(travel(wrapper).exists()).toBe(false);
      expect(wrapper.classes()).toContain("opacity-0");
    });

    it("gives way to a determinate value", () => {
      const wrapper = mountLine({ indeterminate: true, value: 40 });
      expect(travel(wrapper).exists()).toBe(false);
      expect(wrapper.vm.displayPercentage).toBe(40);
    });
  });
});
