// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

vi.mock("@/lib/feedback/Skeleton/OSkeleton.vue", () => ({
  default: {
    name: "OSkeleton",
    template: '<div data-test="oskeleton">Loading...</div>',
  },
}));

import ProtocolRunSummarySkeleton from "./ProtocolRunSummarySkeleton.vue";

describe("ProtocolRunSummarySkeleton", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  function mountComponent() {
    return mount(ProtocolRunSummarySkeleton);
  }

  it("should render the root status container with correct aria attributes and data-test", () => {
    wrapper = mountComponent();

    const root = wrapper.find('[data-test="synthetics-protocol-run-skeleton"]');
    expect(root.exists()).toBe(true);
    expect(root.attributes("role")).toBe("status");
    expect(root.attributes("aria-label")).toBe("synthetics.protocolRun.loading");
    expect(root.attributes("aria-live")).toBe("polite");
  });

  it("should render exactly 4 grid cells", () => {
    wrapper = mountComponent();

    const grid = wrapper.find(".grid-cols-2");
    expect(grid.exists()).toBe(true);
    expect(grid.element.children.length).toBe(4);
  });

  it("should render the accent-strip header element", () => {
    wrapper = mountComponent();

    const accentStrip = wrapper.find(".bg-accent");
    expect(accentStrip.exists()).toBe(true);
  });
});
