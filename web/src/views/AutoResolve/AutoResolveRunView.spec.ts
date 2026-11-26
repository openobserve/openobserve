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

import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import type { AutoResolveRun } from "@/services/autoresolve";
import {
  autoresolveOption,
  autoresolveRun,
  autoresolveStep,
} from "@/test/unit/fixtures/autoresolveRun";
import {
  RCA_T0,
  rcaEvidenceEntry,
  rcaHypothesis,
  rcaStep,
  rcaThread,
  rcaToolCall,
  sec,
} from "@/test/unit/fixtures/rcaThread";

const shown = ref<AutoResolveRun | null>(null);
vi.mock("@/composables/useAutoResolveRun", () => ({
  useAutoResolveRun: () => ({
    run: shown,
    live: ref(false),
    reconnecting: ref(false),
    error: ref(null),
    errorStatus: ref(null),
    refresh: vi.fn(() => Promise.resolve()),
    retry: vi.fn(),
  }),
}));

import AutoResolveRunView from "./AutoResolveRunView.vue";

const PageLayoutStub = {
  props: ["title", "subtitle", "back", "icon"],
  template: "<div><slot name='title-trail' /><slot name='actions' /><slot /></div>",
};

const call = (id: string, at: number) =>
  rcaToolCall({ call_id: id, tool: id, started_at: RCA_T0 + sec(at), duration_ms: 1_000 });
const planned = (revision: number, at: number, titles: [string, "high" | "medium"][]) => ({
  revision,
  planned_at_us: RCA_T0 + sec(at),
  cause: `Cause of plan ${revision}`,
  band: "medium" as const,
  missing_capability: null,
  options: titles.map(([title, band], i) => ({ id: `o${i}`, title, band, partial_fix: null })),
});

// Plan 1, a wrong-cause correction on Revert, then plan 2 from a second investigation.
const corrected = (): AutoResolveRun =>
  autoresolveRun({
    revision: 2,
    planned_at_us: RCA_T0 + sec(300),
    plan: {
      ...autoresolveRun().plan!,
      fingerprint: "fp-2",
      options: [autoresolveOption({ title: "Scale up", band: "high" })],
      cause: "Cause of plan 2",
      band: "medium",
    },
    plan_history: [
      planned(1, 100, [
        ["Revert", "high"],
        ["Patch directly", "medium"],
      ]),
      planned(2, 300, [["Scale up", "high"]]),
    ],
    corrections: [
      {
        id: "cor-1",
        kind: "wrong_cause",
        note: "The timeout is fine.",
        created_by: "lead@example.com",
        created_at_us: RCA_T0 + sec(150),
        remembered: false,
        option_title: "Revert",
        revision: 1,
      },
    ],
    thread: rcaThread({
      active: false,
      steps: [
        rcaStep({ index: 1, tool_calls: [call("read_logs", 2)] }),
        rcaStep({ index: 2, started_at: RCA_T0 + sec(210), tool_calls: [call("read_pods", 210)] }),
      ],
      user_messages: [{ at: RCA_T0 + sec(200), text: "Plan again.", steer_id: null }],
    }),
  });

let wrapper: VueWrapper | undefined;
const mountView = (run: AutoResolveRun) => {
  shown.value = run;
  wrapper = mount(AutoResolveRunView, {
    global: {
      plugins: [i18n, store, router],
      provide: { store },
      stubs: { OPageLayout: PageLayoutStub },
    },
  });
  return wrapper;
};

afterEach(() => {
  wrapper?.unmount();
  shown.value = null;
});

describe("AutoResolveRunView", () => {
  it("the This run panel holds the timeline: each investigation, plan and correction in order", () => {
    const w = mountView(corrected());

    expect(w.find('[data-test="autoresolve-run-evidence"]').exists()).toBe(false);
    const timeline = w
      .find('[data-test="autoresolve-run-facts"]')
      .find('[data-test="autoresolve-run-timeline"]');
    const items = timeline.findAll("li");
    expect(items.map((li) => li.attributes("data-test"))).toEqual([
      "autoresolve-run-timeline-started",
      "autoresolve-run-timeline-investigated",
      "autoresolve-run-timeline-plan",
      "autoresolve-run-timeline-correction",
      "autoresolve-run-timeline-investigated",
      "autoresolve-run-timeline-plan",
    ]);
    const [, firstPass, firstPlan, correction] = items;
    expect(firstPass.text()).toContain("1 call");
    expect(firstPlan.text()).toContain("Cause of plan 1");
    expect(firstPlan.text()).toContain("Revert (High)");
    expect(firstPlan.text()).toContain("Patch directly (Medium)");
    expect(correction.text()).toContain(
      "Correction sent by lead@example.com on Revert: Wrong cause",
    );
  });

  it("after a not-fixed replan the timeline keeps the first attempt's approval, step and end", () => {
    const first = {
      ...planned(1, 100, [["Scale up", "high"]]),
      attempt: {
        option_id: "o0",
        approved_by: "dana@example.com",
        approved_at_us: RCA_T0 + sec(120),
        steps: [
          autoresolveStep({
            id: "s-1",
            tool: "scale_service",
            state: "done",
            consumed_at_us: RCA_T0 + sec(121),
            finished_at_us: RCA_T0 + sec(122),
          }),
        ],
        state: "worked" as const,
        verdict: "worked",
        explanation: "Lag back to normal.",
        ended_at_us: RCA_T0 + sec(130),
      },
    };
    const w = mountView({
      ...corrected(),
      plan_history: [first, planned(2, 300, [["Roll back", "medium"]])],
      corrections: [
        {
          id: "cor-1",
          kind: "not_fixed",
          note: "Lag is still up.",
          created_by: "lead@example.com",
          created_at_us: RCA_T0 + sec(150),
          remembered: false,
          option_title: "Scale up",
          revision: 1,
        },
      ],
    });

    const items = w.find('[data-test="autoresolve-run-timeline"]').findAll("li");
    expect(items.map((li) => li.attributes("data-test"))).toEqual([
      "autoresolve-run-timeline-started",
      "autoresolve-run-timeline-investigated",
      "autoresolve-run-timeline-plan",
      "autoresolve-run-timeline-approved",
      "autoresolve-run-timeline-step",
      "autoresolve-run-timeline-attempt-ended",
      "autoresolve-run-timeline-correction",
      "autoresolve-run-timeline-investigated",
      "autoresolve-run-timeline-plan",
    ]);
    const text = (i: number) => items[i].text();
    expect(text(3)).toContain("dana@example.com approved Scale up");
    expect(text(5)).toContain("Ended: Worked");
    expect(text(6)).toContain("Scale up didn't fix it: Lag is still up.");
  });

  it("a replan's live list holds only its own turn; earlier steps stay in Investigated", () => {
    const w = mountView({
      ...corrected(),
      state: "investigating",
      plan_history: [planned(1, 100, [["Scale up", "high"]])],
      turn: {
        started_at_us: RCA_T0 + sec(200),
        deadline_us: RCA_T0 + sec(900),
        last_output_us: RCA_T0 + sec(210),
        check_retry: false,
      },
      thread: rcaThread({
        active: true,
        steps: [
          rcaStep({ index: 1, title: "First look", tool_calls: [call("read_logs", 2)] }),
          rcaStep({
            index: 2,
            title: "Re-check before the change",
            started_at: RCA_T0 + sec(140),
            ended_at: null,
            tool_calls: [call("scale_service", 140)],
          }),
          rcaStep({
            index: 3,
            title: "Look again",
            started_at: RCA_T0 + sec(210),
            tool_calls: [call("read_pods", 210)],
          }),
        ],
      }),
    });

    const live = w.find('[data-test="autoresolve-run-investigating"]');
    expect(live.text()).toContain("Look again");
    expect(live.text()).not.toContain("Re-check before the change");
    expect(live.text()).not.toContain("First look");
    expect(w.find('[data-test="autoresolve-run-investigated"]').exists()).toBe(true);
  });

  it("Ask leads; the investigation below it holds the hypotheses, evidence and steps", async () => {
    const base = corrected();
    const w = mountView({
      ...base,
      state: "waiting_approval",
      plan: {
        ...base.plan!,
        evidence: [rcaEvidenceEntry()],
        unverified: [],
        hypotheses: [rcaHypothesis()],
      },
    });
    const main = w.find('[data-test="autoresolve-run-main"]');
    const request = main.find('[data-test="autoresolve-approval-request"]');
    const investigation = main.find('[data-test="autoresolve-run-investigated"]');
    const after = request.element.compareDocumentPosition(investigation.element);
    expect(after & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(investigation.text()).toContain("1 cited read, 1 decisive");

    await request.find('[data-test="autoresolve-approval-view-evidence"]').trigger("click");
    await flushPromises();
    expect(investigation.find('[data-test="rca-hypotheses"]').exists()).toBe(true);
    expect(investigation.find('[data-test="rca-evidence-list"]').exists()).toBe(true);
    expect(investigation.find('[data-test="autoresolve-run-investigated-steps"]').exists()).toBe(
      true,
    );
  });

  it("a low band opens the investigation on its own", () => {
    const base = corrected();
    const w = mountView({
      ...base,
      state: "waiting_approval",
      plan: {
        ...base.plan!,
        band: "low",
        evidence: [rcaEvidenceEntry({ decisive: false })],
        unverified: [],
        hypotheses: [rcaHypothesis()],
      },
    });
    const investigation = w.find('[data-test="autoresolve-run-investigated"]');
    expect(investigation.find('[data-test="rca-evidence-list"]').exists()).toBe(true);
  });

  it("a run that only started shows no timeline", () => {
    const w = mountView(
      autoresolveRun({ state: "investigating", plan: null, thread: rcaThread({ steps: [] }) }),
    );
    expect(w.find('[data-test="autoresolve-run-timeline"]').exists()).toBe(false);
  });

  it("Investigated keeps every pass up to the current plan, headed by who corrected", async () => {
    const w = mountView(corrected());
    const investigated = w.find('[data-test="autoresolve-run-investigated"]');

    expect(investigated.text()).toContain("2 calls");
    await investigated.find("button").trigger("click");
    await flushPromises();
    const heading = investigated.find('[data-test="autoresolve-run-investigated-pass"]');
    expect(heading.text()).toMatch(/^Corrected by lead@example\.com at /);
    expect(investigated.findAll('[data-test="autoresolve-run-investigated-pass"]')).toHaveLength(1);
  });
});
