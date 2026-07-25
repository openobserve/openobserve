// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import type { Win } from "@/plugins/traces/versionCompare/windows";

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

import VersionWindowCard from "./VersionWindowCard.vue";

const win: Win = { start: 0, end: 3_600_000_000 * 12 };

const mountCard = (overrides: Record<string, unknown> = {}) =>
  mount(VersionWindowCard, {
    props: {
      arm: "a",
      env: "prod",
      version: "1.5.0",
      window: win,
      traceCount: 250,
      limitedBy: null,
      deltaHours: 12,
      ...overrides,
    },
  });

describe("VersionWindowCard", () => {
  it("renders an env-aware label containing both env and version", () => {
    const wrapper = mountCard({ env: "prod", version: "1.5.0" });
    const label = wrapper.find('[data-test="version-window-card-a-label"]');
    expect(label.exists()).toBe(true);
    expect(label.text()).toContain("prod");
    expect(label.text()).toContain("1.5.0");
  });

  it("distinguishes two cards with the same version but different env", () => {
    const wrapperA = mountCard({ arm: "a", env: "prod", version: "1.5.0" });
    const wrapperB = mountCard({ arm: "b", env: "staging", version: "1.5.0" });
    const labelA = wrapperA.find('[data-test="version-window-card-a-label"]').text();
    const labelB = wrapperB.find('[data-test="version-window-card-b-label"]').text();
    expect(labelA).not.toBe(labelB);
    expect(labelA).toContain("prod");
    expect(labelB).toContain("staging");
  });

  it("renders trace count in the label", () => {
    const wrapper = mountCard({ traceCount: 250 });
    expect(wrapper.find('[data-test="version-window-card-a-label"]').text()).toContain("250");
  });

  it("renders clamp copy with a human-formatted duration (not a raw float)", () => {
    // arm=a, limitedBy="b" means b's window was the limiter — a is being clamped.
    // formatDuration(6) → "6.0h" (never a raw "6" or "0.00994...").
    const wrapper = mountCard({ arm: "a", limitedBy: "b", deltaHours: 6 });
    const clamp = wrapper.find('[data-test="version-window-card-a-clamp"]');
    expect(clamp.exists()).toBe(true);
    expect(clamp.text()).toContain("6.0h");
  });

  it("formats a sub-minute clamp window as seconds, never a raw hours float", () => {
    // 0.00994h ≈ 36s — the exact bug the user flagged ("0.009945833...h").
    const wrapper = mountCard({ arm: "a", limitedBy: "b", deltaHours: 0.009945833 });
    const clamp = wrapper.find('[data-test="version-window-card-a-clamp"]');
    expect(clamp.text()).toContain("36s");
    expect(clamp.text()).not.toContain("0.00");
  });

  it("does not render clamp copy when limitedBy is null", () => {
    const wrapper = mountCard({ arm: "a", limitedBy: null });
    expect(wrapper.find('[data-test="version-window-card-a-clamp"]').exists()).toBe(false);
  });

  it("does not render clamp copy when limitedBy names this arm itself (not the counterpart)", () => {
    // arm=a, limitedBy="a" means a itself was the limiter (a's natural window is shorter) —
    // a's window is NOT clamped, b's is. So a shows no clamp copy.
    const wrapper = mountCard({ arm: "a", limitedBy: "a" });
    expect(wrapper.find('[data-test="version-window-card-a-clamp"]').exists()).toBe(false);
  });

  it("renders an accent color chip for arm a and the series-b chip for arm b", () => {
    const wrapperA = mountCard({ arm: "a" });
    const wrapperB = mountCard({ arm: "b" });
    expect(wrapperA.find('[data-test="version-window-card-a-chip"]').classes().join(" ")).toContain("accent");
    expect(wrapperB.find('[data-test="version-window-card-b-chip"]').classes().join(" ")).toContain("series-b");
  });
});
