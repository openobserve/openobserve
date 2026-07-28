// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";

// Resolve i18n against the REAL en-US.json — guards the actual shipped keys.
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

import VersionCompareBar from "./VersionCompareBar.vue";

const OSelect = {
  props: ["modelValue", "label", "options", "dataTest"],
  emits: ["update:modelValue"],
  template:
    '<div class="o-select" :data-test="dataTest">' +
    '<span class="opt" v-for="o in options" :key="String(o.value)" :data-value="o.value" @click="$emit(\'update:modelValue\', o.value)">{{ o.label }}</span>' +
    "</div>",
};

const stubs = { OSelect };

const UNSET = "__unset__";

const opt = (v: string, label?: string): SelectOption => ({ label: label ?? v, value: v });

const versions: SelectOption[] = [opt("1.0.0"), opt("1.5.0"), opt(UNSET, "(unset)")];

const mountBar = (overrides: Record<string, unknown> = {}) =>
  mount(VersionCompareBar, {
    global: { stubs },
    props: {
      versions,
      a: "1.0.0",
      b: "1.5.0",
      ...overrides,
    },
  });

describe("VersionCompareBar", () => {
  it("renders the two version slots (align + exit moved out of the bar)", () => {
    const wrapper = mountBar();
    expect(wrapper.find('[data-test="version-compare-bar-a"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="version-compare-bar-b"]').exists()).toBe(true);
    // Align toggle and exit no longer live in the bar.
    expect(wrapper.find('[data-test="version-compare-bar-align"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="version-compare-bar-exit"]').exists()).toBe(false);
  });

  it("excludes the UNSET sentinel from both slot option lists", () => {
    const wrapper = mountBar();
    const slotA = wrapper.find('[data-test="version-compare-bar-a"]');
    const slotB = wrapper.find('[data-test="version-compare-bar-b"]');
    expect(slotA.find(`[data-value="${UNSET}"]`).exists()).toBe(false);
    expect(slotB.find(`[data-value="${UNSET}"]`).exists()).toBe(false);
  });

  it("shows the 'pick two different versions' hint when A === B", () => {
    const wrapper = mountBar({ a: "1.0.0", b: "1.0.0" });
    expect(wrapper.find('[data-test="version-compare-bar-same-hint"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Pick two different versions to compare");
  });

  it("does not show the hint when A and B differ", () => {
    const wrapper = mountBar({ a: "1.0.0", b: "1.5.0" });
    expect(wrapper.find('[data-test="version-compare-bar-same-hint"]').exists()).toBe(false);
  });

  it("emits update:a / update:b when a version is picked", async () => {
    const wrapper = mountBar();
    await wrapper
      .find('[data-test="version-compare-bar-a"] .opt[data-value="1.5.0"]')
      .trigger("click");
    expect(wrapper.emitted("update:a")?.[0]).toEqual(["1.5.0"]);

    await wrapper
      .find('[data-test="version-compare-bar-b"] .opt[data-value="1.0.0"]')
      .trigger("click");
    expect(wrapper.emitted("update:b")?.[0]).toEqual(["1.0.0"]);
  });
});
