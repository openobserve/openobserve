// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import i18n from "@/locales";
import StepPageActivity from "./StepPageActivity.vue";
import type { EvidenceEvent } from "@/composables/synthetics/syntheticResultsSchema";

const ev = (i: number): EvidenceEvent => ({
  ts: i,
  stepId: "s4",
  kind: "response",
  level: null,
  text: null,
  message: null,
  stack: null,
  method: "GET",
  url: `https://app.dev/r${i}`,
  status: 200,
  resourceType: null,
  initiatedTs: i,
  durationMs: 10,
  firstParty: true,
  stepName: "Click Sign In",
});

const mountBlock = (props: Record<string, unknown> = {}) =>
  mount(StepPageActivity, {
    props: {
      stepId: "s4",
      events: [ev(1), ev(2)],
      status: "ready",
      error: null,
      truncated: false,
      unattributedCount: 0,
      ...props,
    },
    global: { plugins: [i18n] },
  });

describe("StepPageActivity", () => {
  it("caps the inline list at five rows", () => {
    // A live bundle held 136 events on one step; uncapped it destroys the timeline.
    const w = mountBlock({ events: Array.from({ length: 12 }, (_, i) => ev(i)) });
    expect(w.findAll('[data-test="synthetics-evidence-events-row"]')).toHaveLength(5);
  });

  it("counts what it showed against what exists", () => {
    const w = mountBlock({ events: Array.from({ length: 12 }, (_, i) => ev(i)) });
    expect(w.find('[data-test="synthetics-step-page-activity-count"]').text()).toContain("5 of 12");
  });

  it("marks the total as a floor when capture was truncated", () => {
    // A silently short list reads as a quiet run.
    const w = mountBlock({ events: [ev(1)], truncated: true });
    expect(w.find('[data-test="synthetics-step-page-activity-count"]').text()).toContain("+");
  });

  it("offers the full list only when there is more than it showed", () => {
    expect(
      mountBlock({ events: [ev(1), ev(2)] })
        .find('[data-test="synthetics-step-page-activity-view-all-btn"]')
        .exists(),
    ).toBe(false);
    expect(
      mountBlock({ events: Array.from({ length: 12 }, (_, i) => ev(i)) })
        .find('[data-test="synthetics-step-page-activity-view-all-btn"]')
        .exists(),
    ).toBe(true);
  });

  it("names the step it wants shown, so the panel can filter to it", async () => {
    const w = mountBlock({ events: Array.from({ length: 12 }, (_, i) => ev(i)) });
    await w.find('[data-test="synthetics-step-page-activity-view-all-btn"]').trigger("click");
    expect(w.emitted("view-all")).toEqual([["s4"]]);
  });

  it("shows skeletons while the bundle is in flight", () => {
    const w = mountBlock({ status: "loading", events: [] });
    expect(w.find('[data-test="synthetics-step-page-activity-loading"]').exists()).toBe(true);
  });

  it("reports a failed load and offers a retry", async () => {
    const w = mountBlock({ status: "error", error: "403 Forbidden", events: [] });
    expect(w.find('[data-test="synthetics-step-page-activity-error"]').text()).toContain("403");
    await w.find('[data-test="synthetics-step-page-activity-retry-btn"]').trigger("click");
    expect(w.emitted("retry")).toBeTruthy();
  });

  it("names the unattributed remainder when this step's window was empty", () => {
    // Otherwise "this step shows nothing" reads as "the run was quiet" — and
    // attribution is sparse: a live 158-event bundle had two distinct step ids.
    const w = mountBlock({ events: [], unattributedCount: 158 });
    expect(w.find('[data-test="synthetics-step-page-activity-empty"]').text()).toContain("158");
  });

  it("says only that the window was empty when nothing is unattributed either", () => {
    const w = mountBlock({ events: [], unattributedCount: 0 });
    const text = w.find('[data-test="synthetics-step-page-activity-empty"]').text();
    expect(text).toContain("No events in this step's window.");
    expect(text).not.toContain("0 events were not attributed");
  });
});
