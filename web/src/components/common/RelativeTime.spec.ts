import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import RelativeTime from "@/components/common/RelativeTime.vue";
import store from "@/test/unit/helpers/store";
import { timestampToTimezoneDate } from "@/utils/zincutils";

installQuasar();

vi.mock("@/utils/zincutils", () => ({
  timestampToTimezoneDate: vi.fn(() => "2023-01-01 10:00:00.000")
}));

describe("RelativeTime", () => {
  let wrapper: any = null;
  
  beforeEach(() => {
    vi.clearAllTimers();
    vi.useFakeTimers();
    store.state.timezone = "UTC";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const createWrapper = (props = {}) => {
    return mount(RelativeTime, {
      props,
      global: {
        provide: {
          store,
        },
      },
    });
  };

  it("should mount RelativeTime component", () => {
    wrapper = createWrapper({ timestamp: Date.now() });
    expect(wrapper).toBeTruthy();
  });

  it("should display empty string when no timestamp provided", () => {
    wrapper = createWrapper();
    expect(wrapper.text()).toBe("");
  });

  it("should display empty string when timestamp is null", () => {
    wrapper = createWrapper({ timestamp: null });
    expect(wrapper.text()).toBe("");
  });

  it("should render with timestamp", () => {
    const timestamp = Date.now() - 30000;
    wrapper = createWrapper({ timestamp });
    expect(wrapper.exists()).toBe(true);
  });

  it("should have correct props", () => {
    const timestamp = Date.now();
    wrapper = createWrapper({ timestamp, fullTimePrefix: "Test prefix" });
    expect(wrapper.props('timestamp')).toBe(timestamp);
    expect(wrapper.props('fullTimePrefix')).toBe("Test prefix");
  });

  it("should expose relativeTime and formattedExactTime from setup", () => {
    wrapper = createWrapper({ timestamp: Date.now() });
    expect(wrapper.vm.relativeTime).toBeDefined();
    expect(wrapper.vm.formattedExactTime).toBeDefined();
  });
});