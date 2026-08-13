// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import CompositeAlertPreview from "./CompositeAlertPreview.vue";
import i18n from "@/locales";

const diagnostic = (overrides: Record<string, unknown> = {}) => ({
  alert_id: "id-a",
  name: "High error rate",
  alert_type: "scheduled",
  folder_id: "default",
  enabled: true,
  accessible: true,
  level: "critical",
  level_at: 1_786_500_000_000_000,
  stale_deadline: 1_786_500_180_000_000,
  effective_cadence_seconds: 60,
  stale: false,
  truth: true,
  ...overrides,
});

const preview = (children: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) => ({
  valid: true,
  canonical_expression: "({id-a} && {id-b})",
  result: true,
  result_level: "critical",
  stale_child_policy: "use_last_state",
  warning_counts_as_firing: true,
  children,
  warnings: [],
  errors: [],
  ...overrides,
});

const mountPreview = (value: Record<string, unknown>) =>
  mount(CompositeAlertPreview, {
    props: { preview: value },
    global: { plugins: [i18n] },
  });

describe("CompositeAlertPreview", () => {
  it.each([
    ["Warning counts as firing", diagnostic({ level: "warning", truth: true }), "true"],
    ["Warning does not count as firing", diagnostic({ level: "warning", truth: false }), "false"],
    ["Disabled", diagnostic({ enabled: false }), "disabled"],
    ["Never evaluated", diagnostic({ level: null, level_at: null, stale_deadline: null, stale: true, truth: false }), "never"],
  ])("shows the server diagnostic for %s", (_name, child, expected) => {
    const wrapper = mountPreview(preview([child]));
    expect(wrapper.find('[data-test="alerts-composite-preview-child-id-a"]').text().toLowerCase()).toContain(expected);
  });

  it("distinguishes stale use-last-state from a currently Critical child", () => {
    const wrapper = mountPreview(
      preview([
        diagnostic({
          stale: true,
          truth: true,
          stale_reason: "freshness_expired",
          policy_decision: "used_last_state",
        }),
      ]),
    );
    const row = wrapper.find('[data-test="alerts-composite-preview-child-id-a"]');

    expect(row.text()).toMatch(/freshness.*expired/i);
    expect(row.text()).toMatch(/using.*last.*critical/i);
    expect(row.find('[data-test="alerts-composite-preview-stale-deadline"]').exists()).toBe(true);
  });

  it("renders server validation errors and warning diagnostics without treating warnings as blockers", () => {
    const wrapper = mountPreview(
      preview([diagnostic({ enabled: false })], {
        valid: false,
        result: null,
        result_level: null,
        warnings: [{ code: "child_disabled", child_alert_id: "id-a" }],
        errors: [{ code: "composite_too_deep", message: "Maximum depth is two" }],
      }),
    );

    expect(wrapper.find('[data-test="alerts-composite-preview-warning-child_disabled"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alerts-composite-preview-error-composite_too_deep"]').text()).toContain("Maximum depth is two");
    expect(wrapper.find('[data-test="alerts-composite-preview-result"]').attributes("aria-live")).toBe("polite");
  });

  it("masks an inaccessible child to its ID and accessibility flag", () => {
    const wrapper = mountPreview(
      preview([{ alert_id: "secret-id", accessible: false }]),
    );
    const row = wrapper.find('[data-test="alerts-composite-preview-child-secret-id"]');

    expect(row.text()).not.toMatch(/critical|warning|ok|stale/i);
    expect(row.text()).toContain("secret-id");
  });

  it("uses theme tokens rather than a theme-specific render branch", async () => {
    document.documentElement.classList.add("dark");
    const dark = mountPreview(preview([diagnostic()])).html();
    document.documentElement.classList.remove("dark");
    const light = mountPreview(preview([diagnostic()])).html();

    expect(dark).toBe(light);
    expect(dark).not.toContain("body--dark");
  });
});
