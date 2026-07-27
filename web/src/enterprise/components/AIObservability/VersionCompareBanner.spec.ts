// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("vue-i18n", async () => {
  const en: any = (await import("@/locales/languages/en-US.json")).default;
  return {
    useI18n: vi.fn(() => ({
      t: (key: string, params?: Record<string, unknown>) => {
        const msg = key.split(".").reduce((a: any, k) => (a == null ? a : a[k]), en);
        if (typeof msg !== "string") return key;
        if (!params) return msg;
        return Object.keys(params).reduce(
          (acc, k) => acc.replace(new RegExp(`{${k}}`, "g"), String(params[k])),
          msg,
        );
      },
    })),
  };
});

import VersionCompareBanner from "./VersionCompareBanner.vue";

const OBanner = {
  props: ["variant", "dataTest"],
  template: '<div class="o-banner" :data-variant="variant" :data-test="dataTest"><slot /></div>',
};

const stubs = { OBanner };

const mountBanner = (overrides: Record<string, unknown> = {}) =>
  mount(VersionCompareBanner, {
    global: { stubs },
    props: {
      overlap: "concurrent",
      enoughSample: true,
      nA: 500,
      nB: 500,
      deltaHours: 12,
      ...overrides,
    },
  });

describe("VersionCompareBanner", () => {
  it("renders nothing when enoughSample and overlap is concurrent", () => {
    const wrapper = mountBanner({ overlap: "concurrent", enoughSample: true });
    expect(wrapper.find('[data-test="version-compare-banner"]').exists()).toBe(false);
    expect(wrapper.html().trim()).toBe("<!--v-if-->");
  });

  it("renders the small-sample variant when !enoughSample, with nA/nB interpolated", () => {
    const wrapper = mountBanner({ enoughSample: false, nA: 12, nB: 8, overlap: "concurrent" });
    const banner = wrapper.find('[data-test="version-compare-banner-small-sample"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("A has 12");
    expect(banner.text()).toContain("B has 8");
  });

  it("renders the disjoint overlap variant", () => {
    const wrapper = mountBanner({ overlap: "disjoint", enoughSample: true });
    const banner = wrapper.find('[data-test="version-compare-banner-overlap-disjoint"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("ran at different times");
  });

  it("renders the partial overlap variant", () => {
    const wrapper = mountBanner({ overlap: "partial", enoughSample: true });
    const banner = wrapper.find('[data-test="version-compare-banner-overlap-partial"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("partially concurrent");
  });

  it("prefers the small-sample banner when both guardrails trip", () => {
    const wrapper = mountBanner({ overlap: "disjoint", enoughSample: false });
    expect(wrapper.find('[data-test="version-compare-banner-small-sample"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="version-compare-banner-overlap-disjoint"]').exists()).toBe(
      false,
    );
  });

  it("uses warning tone", () => {
    const wrapper = mountBanner({ overlap: "disjoint", enoughSample: true });
    expect(wrapper.find(".o-banner").attributes("data-variant")).toBe("warning");
  });
});
