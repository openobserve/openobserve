// Copyright 2023 OpenObserve Inc.
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

    expect(wrapper.html()).toContain("tw:w-full");
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

    const container = wrapper.find(".tw\\:absolute");
    expect(container.classes()).toContain("tw:opacity-0");
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

    const container = wrapper.find(".tw\\:absolute");
    expect(container.classes()).toContain("tw:opacity-100");
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

    expect(wrapper.html()).toContain("tw:bg-gray-700");
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

    expect(wrapper.html()).toContain("tw:bg-gray-200");
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

    expect(wrapper.html()).toContain("tw:absolute tw:top-0");
    expect(wrapper.html()).toContain("tw:rounded-full");
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

    const container = wrapper.find(".tw\\:absolute");
    expect(container.classes()).toContain("tw:top-0");
    expect(container.classes()).toContain("tw:z-[999]");
  });
});
