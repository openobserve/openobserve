// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CompositeAlertDetail from "./CompositeAlertDetail.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import alertsService from "@/services/alerts";

vi.mock("@/services/alerts", () => ({
  default: { getCompositeTimeline: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(alertsService.getCompositeTimeline).mockResolvedValue({
    data: {
      from: 0,
      to: 1,
      children: [],
      result: { alert_id: "composite-1", accessible: true, transitions: [] },
    },
  });
});

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
    global: { plugins: [i18n, store] },
  });

describe("CompositeAlertDetail", () => {
  it("shows the current result, live evaluation, and name-resolved expression", () => {
    const wrapper = mountDetail(makeDetail());

    expect(wrapper.find('[data-test="alerts-composite-detail-result"]').text()).toMatch(
      /critical/i,
    );
    expect(wrapper.find('[data-test="alerts-composite-detail-expression-live"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="alerts-composite-detail-expression"]').text()).toMatch(
      /High error rate.*AND.*High latency/s,
    );
  });

  it("renders a level and outcome card per readable child", () => {
    const wrapper = mountDetail(makeDetail());
    const first = wrapper.find('[data-test="alerts-composite-detail-child-id-a"]');

    expect(first.text()).toMatch(/High error rate/i);
    expect(first.text()).toMatch(/critical/i);
    expect(first.text()).toMatch(/firing/i);
    expect(first.find('[data-test="alerts-composite-detail-level-at-id-a"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alerts-composite-detail-child-id-b"]').text()).toMatch(
      /warning/i,
    );
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

  it("makes use-last-state explicit in the configuration summary", () => {
    const wrapper = mountDetail(makeDetail());

    expect(wrapper.find('[data-test="alerts-composite-detail-stale-policy"]').text()).toMatch(
      /use.*last.*state/i,
    );
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

    expect(
      wrapper.find('[data-test="alerts-composite-detail-child-link-id-a"]').attributes("href"),
    ).toContain("id-a");
    const secret = wrapper.find('[data-test="alerts-composite-detail-child-secret-id"]');
    expect(secret.text()).not.toMatch(/critical|warning|firing|stale/i);
    expect(
      wrapper.find('[data-test="alerts-composite-detail-child-link-secret-id"]').exists(),
    ).toBe(false);
  });

  it("preserves a long child name in the link title while truncating visually", () => {
    const longName = `Checkout ${"regional-database-failover-".repeat(12)}`;
    const base = makeDetail();
    const child = (base.children as Array<Record<string, unknown>>)[0];
    const wrapper = mountDetail(makeDetail({ children: [{ ...child, name: longName }] }));
    const link = wrapper.find('[data-test="alerts-composite-detail-child-link-id-a"]');

    expect(link.attributes("title")).toBe(longName);
  });
});
