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
import EvidenceEvents from "./EvidenceEvents.vue";
import EvidenceFilters from "./EvidenceFilters.vue";
import type { EvidenceEvent } from "@/composables/synthetics/syntheticResultsSchema";

const ev = (over: Partial<EvidenceEvent> = {}): EvidenceEvent => ({
  ts: 0,
  stepId: "s4",
  kind: "response",
  level: null,
  text: null,
  message: null,
  stack: null,
  method: "GET",
  url: "https://app.dev/r0",
  status: 200,
  resourceType: null,
  initiatedTs: 0,
  durationMs: 10,
  firstParty: true,
  stepName: "Click Sign In",
  ...over,
});

// n distinct events on this step, ordered by ts — the shape "a live bundle
// held 136 events on one step" tests want without repeating the fixture.
const manyEvents = (n: number): EvidenceEvent[] =>
  Array.from({ length: n }, (_, i) => ev({ ts: i, initiatedTs: i, url: `https://app.dev/r${i}` }));

const mountActivity = (props: Record<string, unknown> = {}) =>
  mount(StepPageActivity, {
    props: {
      stepId: "s4",
      events: manyEvents(2),
      status: "ready",
      error: null,
      truncated: false,
      unattributedCount: 0,
      ...props,
    },
    global: { plugins: [i18n] },
  });

describe("StepPageActivity", () => {
  it("renders the step's whole bucket, not a top five", () => {
    const w = mountActivity({ events: manyEvents(12) });
    expect(w.findComponent(EvidenceEvents).props("events")).toHaveLength(12);
  });

  it("counts what the step has, not what it managed to show", () => {
    const w = mountActivity({ events: manyEvents(12) });
    expect(w.find('[data-test="synthetics-step-page-activity-count"]').text()).toContain("12");
  });

  it("keeps the way to the run-level view open even when nothing overflows", () => {
    const w = mountActivity({ events: manyEvents(2) });
    expect(w.find('[data-test="synthetics-step-page-activity-view-all-btn"]').exists()).toBe(true);
  });

  it("does not nest a scrollbar inside the step expansion", () => {
    const w = mountActivity({ events: manyEvents(12) });
    const box = w.find('[data-test="synthetics-step-page-activity-events"]');
    expect(box.classes().join(" ")).not.toMatch(/overflow-y-auto|max-h-/);
  });

  it("offers the same filters as the run-level panel", () => {
    const w = mountActivity({ events: manyEvents(6) });
    expect(w.findComponent(EvidenceFilters).exists()).toBe(true);
  });

  it("narrows the table when a filter is applied", async () => {
    const w = mountActivity({
      events: [
        ev({ kind: "console", level: "error", text: "boom" }),
        ev({ kind: "response", status: 200 }),
      ],
    });
    await w.find('[data-test="synthetics-evidence-filter-console"]').trigger("click");
    expect(w.findComponent(EvidenceEvents).props("events")).toHaveLength(1);
  });

  it("runs the step's events in time order, since a capped ranking no longer applies", () => {
    const w = mountActivity({
      events: [ev({ ts: 300, status: 200 }), ev({ ts: 100, kind: "pageerror", message: "x" })],
    });
    const shown = w.findComponent(EvidenceEvents).props("events") as Array<{ ts: number }>;
    expect(shown.map((e) => e.ts)).toEqual([100, 300]);
  });

  it("names the step it wants shown, so the panel can filter to it", async () => {
    const w = mountActivity({ events: manyEvents(12) });
    await w.find('[data-test="synthetics-step-page-activity-view-all-btn"]').trigger("click");
    expect(w.emitted("view-all")).toEqual([["s4"]]);
  });

  it("shows skeletons while the bundle is in flight", () => {
    const w = mountActivity({ status: "loading", events: [] });
    expect(w.find('[data-test="synthetics-step-page-activity-loading"]').exists()).toBe(true);
  });

  it("reports a failed load and offers a retry", async () => {
    const w = mountActivity({ status: "error", error: "403 Forbidden", events: [] });
    expect(w.find('[data-test="synthetics-step-page-activity-error"]').text()).toContain("403");
    await w.find('[data-test="synthetics-step-page-activity-retry-btn"]').trigger("click");
    expect(w.emitted("retry")).toBeTruthy();
  });

  it("names the unattributed remainder when this step's window was empty", () => {
    // Otherwise "this step shows nothing" reads as "the run was quiet" — and
    // attribution is sparse: a live 158-event bundle had two distinct step ids.
    const w = mountActivity({ events: [], unattributedCount: 158 });
    expect(w.find('[data-test="synthetics-step-page-activity-empty"]').text()).toContain("158");
  });

  it("says only that the window was empty when nothing is unattributed either", () => {
    const w = mountActivity({ events: [], unattributedCount: 0 });
    const text = w.find('[data-test="synthetics-step-page-activity-empty"]').text();
    expect(text).toContain("No events in this step's window.");
    expect(text).not.toContain("0 events were not attributed");
  });
});
