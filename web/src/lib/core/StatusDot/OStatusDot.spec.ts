// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { raw } from "@/types/i18n";
import OStatusDot from "./OStatusDot.vue";

describe("OStatusDot", () => {
  it.each([
    ["pending", "bg-status-neutral-text"],
    ["active", "bg-status-info-text"],
    ["success", "bg-status-success-text"],
    ["warning", "bg-status-warning-text"],
    ["error", "bg-status-error-text"],
  ] as const)("maps %s to its semantic token", (state, expectedClass) => {
    const wrapper = mount(OStatusDot, {
      props: { state, label: raw(state), dataTest: `status-dot-${state}` },
    });

    expect(wrapper.get(`[data-test="status-dot-${state}"]`).classes()).toContain(expectedClass);
  });

  it("breathes only while active and exposes the state to assistive technology", () => {
    const active = mount(OStatusDot, {
      props: { state: "active", label: raw("In progress") },
    });
    const completed = mount(OStatusDot, {
      props: { state: "success", label: raw("Completed") },
    });

    expect(active.get('[data-test="status-dot"]').classes()).toContain("motion-safe:animate-pulse");
    expect(active.get('[data-test="status-dot"]').attributes("aria-label")).toBe("In progress");
    expect(completed.get('[data-test="status-dot"]').classes()).not.toContain(
      "motion-safe:animate-pulse",
    );
  });

  it("offers a prominent table size without changing the default", () => {
    const compact = mount(OStatusDot, {
      props: { state: "success", label: raw("Completed") },
    });
    const table = mount(OStatusDot, {
      props: { state: "success", label: raw("Completed"), size: "md" },
    });

    expect(compact.get('[data-test="status-dot"]').classes()).toContain("size-2");
    expect(table.get('[data-test="status-dot"]').classes()).toContain("size-2.5");
  });
});
