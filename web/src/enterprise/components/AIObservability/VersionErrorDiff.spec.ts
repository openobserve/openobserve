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

import VersionErrorDiff from "./VersionErrorDiff.vue";
import type { ErrorDiff } from "@/services/gen-ai-agent-mapping.service";

const mountDiff = (errorDiff: ErrorDiff | null) =>
  mount(VersionErrorDiff, { props: { errorDiff } });

function fullDiff(overrides: Partial<ErrorDiff> = {}): ErrorDiff {
  return {
    introduced: [{ fail_class: "timeout", count: 3 }],
    fixed: [{ fail_class: "rate_limit", count: 2 }],
    shared: [{ fail_class: "auth_error", count_a: 5, count_b: 2, delta: 3 }],
    insufficient: false,
    ...overrides,
  };
}

describe("VersionErrorDiff", () => {
  it("renders all three groups with correct counts", () => {
    const wrapper = mountDiff(fullDiff());

    expect(wrapper.find('[data-test="version-error-diff-group-introduced"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="version-error-diff-row-introduced-timeout"]').text()).toContain("3");

    expect(wrapper.find('[data-test="version-error-diff-group-fixed"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="version-error-diff-row-fixed-rate_limit"]').text()).toContain("2");

    expect(wrapper.find('[data-test="version-error-diff-group-shared"]').exists()).toBe(true);
    const sharedRow = wrapper.find('[data-test="version-error-diff-row-shared-auth_error"]');
    expect(sharedRow.text()).toContain("5");
    expect(sharedRow.text()).toContain("2");
  });

  it("colors a worse shared delta (delta>0) as crit with an up arrow", () => {
    const wrapper = mountDiff(fullDiff());
    const delta = wrapper.find('[data-test="version-error-diff-delta-auth_error"]');
    expect(delta.classes()).toContain("text-error-600");
    expect(delta.text()).toBe("▲");
  });

  it("colors a better shared delta (delta<0) as good with a down arrow", () => {
    const wrapper = mountDiff(
      fullDiff({ shared: [{ fail_class: "auth_error", count_a: 1, count_b: 4, delta: -3 }] }),
    );
    const delta = wrapper.find('[data-test="version-error-diff-delta-auth_error"]');
    expect(delta.classes()).toContain("text-success-600");
    expect(delta.text()).toBe("▼");
  });

  it("colors an unchanged shared delta as neutral with a dash", () => {
    const wrapper = mountDiff(
      fullDiff({ shared: [{ fail_class: "auth_error", count_a: 2, count_b: 2, delta: 0 }] }),
    );
    const delta = wrapper.find('[data-test="version-error-diff-delta-auth_error"]');
    expect(delta.classes()).toContain("text-text-secondary");
    expect(delta.text()).toBe("—");
  });

  it("collapses empty groups", () => {
    const wrapper = mountDiff(fullDiff({ introduced: [], fixed: [] }));
    expect(wrapper.find('[data-test="version-error-diff-group-introduced"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="version-error-diff-group-fixed"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="version-error-diff-group-shared"]').exists()).toBe(true);
  });

  it("shows the muted note when insufficient", () => {
    const wrapper = mountDiff(fullDiff({ insufficient: true }));
    expect(wrapper.find('[data-test="version-error-diff-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="version-error-diff-empty"]').text()).toBe(
      "No failure data to compare in this window.",
    );
    expect(wrapper.find('[data-test="version-error-diff-group-introduced"]').exists()).toBe(false);
  });

  it("shows the muted note when errorDiff is null", () => {
    const wrapper = mountDiff(null);
    expect(wrapper.find('[data-test="version-error-diff-empty"]').exists()).toBe(true);
  });
});
