import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import LoadingProgress from "@/components/common/LoadingProgress.vue";
import store from "@/test/unit/helpers/store";

installQuasar();

describe("LoadingProgress", () => {
  let wrapper: any = null;

  beforeEach(() => {
    vi.useFakeTimers();
    store.state.theme = "light";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.useRealTimers();
  });

  const createWrapper = (props = {}) => {
    return mount(LoadingProgress, {
      props: {
        loading: true,
        loadingProgressPercentage: 50,
        ...props
      },
      global: {
        provide: {
          store,
        },
      },
    });
  };

  it("should mount LoadingProgress component", () => {
    wrapper = createWrapper();
    expect(wrapper).toBeTruthy();
  });

  it("should validate loadingProgressPercentage prop", () => {
    const validator = LoadingProgress.props.loadingProgressPercentage.validator;
    expect(validator(50)).toBe(true);
    expect(validator(0)).toBe(true);
    expect(validator(100)).toBe(true);
    expect(validator(-1)).toBe(false);
    expect(validator(101)).toBe(false);
  });

  it("should display correct percentage", () => {
    wrapper = createWrapper({ loadingProgressPercentage: 75 });
    expect(wrapper.vm.displayPercentage).toBe(75);
  });

  it("should display minimum 5% when percentage is less than 5", () => {
    wrapper = createWrapper({ loadingProgressPercentage: 2 });
    expect(wrapper.vm.displayPercentage).toBe(5);
  });

  it("should show 100% when fading out", async () => {
    wrapper = createWrapper({ loading: true });
    
    await wrapper.setProps({ loading: false });
    expect(wrapper.vm.isFadingOut).toBe(true);
    expect(wrapper.vm.displayPercentage).toBe(100);
  });

  it("should fade out after loading completes", async () => {
    wrapper = createWrapper({ loading: true });
    
    await wrapper.setProps({ loading: false });
    expect(wrapper.vm.isFadingOut).toBe(true);
    
    vi.advanceTimersByTime(500);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.isFadingOut).toBe(false);
  });

  it("should handle theme changes", async () => {
    wrapper = createWrapper();
    expect(wrapper.vm.store.state.theme).toBe("light");
    
    store.state.theme = "dark";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.store.state.theme).toBe("dark");
  });

  it("should animate when loading", () => {
    wrapper = createWrapper({ loading: true });
    expect(wrapper.vm.shouldAnimate).toBe(true);
  });

  it("should animate when fading out", async () => {
    wrapper = createWrapper({ loading: true });
    
    await wrapper.setProps({ loading: false });
    expect(wrapper.vm.shouldAnimate).toBe(true);
  });

  it("should clean up timeout on unmount", () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    wrapper = createWrapper({ loading: true });
    
    wrapper.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("should clear previous timeout when loading state changes", async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    wrapper = createWrapper({ loading: true });
    
    await wrapper.setProps({ loading: false });
    await wrapper.setProps({ loading: true });
    await wrapper.setProps({ loading: false });
    
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("should have correct CSS classes for dark theme", () => {
    store.state.theme = "dark";
    wrapper = createWrapper();
    const element = wrapper.find('.tw\\:relative.tw\\:overflow-x-hidden');
    expect(element.classes()).toContain('tw:bg-gray-700');
  });

  it("should have correct CSS classes for light theme", () => {
    store.state.theme = "light";
    wrapper = createWrapper();
    const element = wrapper.find('.tw\\:relative.tw\\:overflow-x-hidden');
    expect(element.classes()).toContain('tw:bg-gray-200');
  });

  it("should show opacity 100 when loading", () => {
    wrapper = createWrapper({ loading: true });
    expect(wrapper.classes()).toContain('tw:opacity-100');
  });

  it("should show opacity 0 when not loading and not fading out", () => {
    wrapper = createWrapper({ loading: false });
    expect(wrapper.classes()).toContain('tw:opacity-0');
  });

  it("should expose correct properties from setup", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.displayPercentage).toBeDefined();
    expect(wrapper.vm.shouldAnimate).toBeDefined();
    expect(wrapper.vm.isFadingOut).toBeDefined();
  });
});