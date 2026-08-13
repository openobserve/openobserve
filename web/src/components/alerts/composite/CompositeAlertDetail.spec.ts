// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import CompositeAlertDetail from "./CompositeAlertDetail.vue";
import i18n from "@/locales";

const makeDetail = (overrides: Record<string, unknown> = {}) => ({
  id: "composite-1",
  alert_type: "composite",
  name: "Checkout degraded",
  enabled: true,
  scheduler_job_present: true,
  composite_condition: {
    expression: "({id-a} && {id-b})",
    warning_counts_as_firing: true,
    stale_child_policy: "use_last_state",
  },
  evaluation: {
    result: true,
    level: "critical",
    evaluated_at: 1_786_500_015_000_000,
  },
  children: [
    {
      alert_id: "id-a",
      name: "High error rate",
      alert_type: "scheduled",
      folder_id: "default",
      enabled: true,
      accessible: true,
      level: "critical",
      last_outcome: "firing",
      level_at: 1_786_500_000_000_000,
      stale_deadline: 1_786_500_180_000_000,
      stale: false,
      truth: true,
    },
    {
      alert_id: "id-b",
      name: "High latency",
      alert_type: "scheduled",
      folder_id: "payments",
      enabled: true,
      accessible: true,
      level: "warning",
      last_outcome: "firing",
      level_at: 1_786_500_001_000_000,
      stale_deadline: 1_786_500_181_000_000,
      stale: false,
      truth: true,
    },
  ],
  ...overrides,
});

const mountDetail = (alert: Record<string, unknown>) =>
  mount(CompositeAlertDetail, {
    props: { alert },
    global: { plugins: [i18n] },
  });

describe("CompositeAlertDetail", () => {
  it("shows the current result, name-resolved expression, and why-firing table", () => {
    const wrapper = mountDetail(makeDetail());

    expect(wrapper.find('[data-test="alerts-composite-detail-result"]').text()).toMatch(/critical/i);
    expect(wrapper.find('[data-test="alerts-composite-detail-expression"]').text()).toMatch(/High error rate.*AND.*High latency/s);
    expect(wrapper.find('[data-test="alerts-composite-detail-children-table"]').exists()).toBe(true);
    const first = wrapper.find('[data-test="alerts-composite-detail-child-id-a"]');
    expect(first.text()).toMatch(/critical.*firing/i);
    expect(first.text()).toMatch(/enabled/i);
    expect(first.find('[data-test="alerts-composite-detail-level-at"]').exists()).toBe(true);
    expect(first.find('[data-test="alerts-composite-detail-freshness"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alerts-composite-detail-child-id-b"]').text()).toMatch(/warning/i);
  });

  it.each([
    [true, false, true],
    [false, false, false],
    [true, true, false],
  ])(
    "missing-job warning follows enabled=%s scheduler_job_present=%s",
    (enabled, schedulerJobPresent, expected) => {
      const wrapper = mountDetail(
        makeDetail({ enabled, scheduler_job_present: schedulerJobPresent }),
      );
      expect(wrapper.find('[data-test="alerts-composite-detail-missing-job"]').exists()).toBe(
        expected,
      );
    },
  );

  it("makes use-last-state and the stale reason explicit", () => {
    const alert = makeDetail();
    const children = alert.children as Array<Record<string, unknown>>;
    children[0] = {
      ...children[0],
      stale: true,
      policy_decision: "used_last_state",
      stale_reason: "freshness_expired",
    };
    const wrapper = mountDetail(alert);

    expect(wrapper.find('[data-test="alerts-composite-detail-stale-policy"]').text()).toMatch(/use.*last.*state/i);
    expect(wrapper.find('[data-test="alerts-composite-detail-child-id-a"]').text()).toMatch(/freshness.*expired.*last.*critical/is);
  });

  it("links readable children and masks inaccessible children", () => {
    const wrapper = mountDetail(
      makeDetail({
        children: [
          (makeDetail().children as Array<Record<string, unknown>>)[0],
          { alert_id: "secret-id", accessible: false },
        ],
      }),
    );

    expect(wrapper.find('[data-test="alerts-composite-detail-child-link-id-a"]').attributes("href")).toContain("id-a");
    const secret = wrapper.find('[data-test="alerts-composite-detail-child-secret-id"]');
    expect(secret.text()).not.toMatch(/critical|warning|firing|stale/i);
    expect(wrapper.find('[data-test="alerts-composite-detail-child-link-secret-id"]').exists()).toBe(false);
  });

  it("preserves a long child name in accessible text while allowing visual truncation", () => {
    const longName = `Checkout ${"regional-database-failover-".repeat(12)}`;
    const base = makeDetail();
    const child = (base.children as Array<Record<string, unknown>>)[0];
    const wrapper = mountDetail(makeDetail({ children: [{ ...child, name: longName }] }));
    const link = wrapper.find('[data-test="alerts-composite-detail-child-link-id-a"]');

    expect(link.attributes("title")).toBe(longName);
    expect(link.attributes("aria-label")).toContain(longName);
  });
});
