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

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));
vi.mock("@/services/incidents", () => ({
  default: {
    getRcaThread: vi.fn(),
    getRcaSummary: vi.fn(),
    getRcaSteering: vi.fn(),
    steerRca: vi.fn(),
    getRcaFeedback: vi.fn(),
  },
}));

import IncidentRCAAnalysis from "./IncidentRCAAnalysis.vue";
import i18n from "@/locales";
import awsConfig from "@/aws-exports";
import type { RcaAskPayload } from "@/utils/incidents/rcaAskAttachment";
import store from "@/test/unit/helpers/store";
import incidentsService from "@/services/incidents";
import { formatTimestamp } from "@/utils/date";
import { RCA_UNFINISHED_TOOL_ERROR, rcaThreadPlainText } from "@/utils/incidents/rcaThread";
import { RCA_STEERING_POLL_MS } from "@/composables/useRcaSteering";
import {
  rcaBlindSpot,
  RCA_T0,
  rcaEvidenceEntry,
  rcaRun,
  rcaRunItem,
  rcaRunSummary,
  rcaRunSummaryBlocked,
  rcaRunSummaryCancelled,
  rcaRunSummaryLegacy,
  rcaRunSummaryLive,
  rcaStep,
  rcaSteerRecord,
  rcaSteering,
  rcaSteeringPaused,
  rcaSteeringUnblocked,
  rcaSummary,
  rcaThread,
  rcaThreadQuestion,
  rcaToolCall,
  rcaV1RunItem,
  rcaV1Summary,
  sec,
} from "@/test/unit/fixtures/rcaThread";
import type { RcaRunSummary } from "@/services/incidents";

const getRcaThread = vi.mocked(incidentsService.getRcaThread);
const getRcaSummary = vi.mocked(incidentsService.getRcaSummary);
const getRcaSteering = vi.mocked(incidentsService.getRcaSteering);
const steerRca = vi.mocked(incidentsService.steerRca);
const getRcaFeedback = vi.mocked(incidentsService.getRcaFeedback);

/** Every read of a run answers `summary` with that run's id. */
const answerSummary = (summary: RcaRunSummary) =>
  getRcaSummary.mockImplementation(
    (_org, _incident, runId) => Promise.resolve({ data: { ...summary, run_id: runId } }) as never,
  );

const REPORT = "## Root Cause\n\nMemory leak in the payment service.";

// ODropdown renders its menu only when open; the stubs render every item so the
// menu contents can be asserted and selected directly.
const stubs = {
  ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: {
    props: { disabled: { type: Boolean, default: false } },
    emits: ["select"],
    template:
      "<div role='menuitem' :data-disabled='disabled' @click=\"!disabled && $emit('select')\"><slot /></div>",
  },
};

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(IncidentRCAAnalysis, {
    props: { orgId: "default", incidentId: "inc-1", ...props },
    global: { plugins: [i18n, store], stubs },
    attachTo: document.body,
  });
}

const byTest = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`);

/** True when `first` comes before `second` in document order. */
const precedes = (first: Element, second: Element) =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

/** The latest run is live: run-2, a re-analysis after the completed run-1. */
const liveProps = (overrides: Record<string, unknown> = {}) => ({
  rca: rcaSummary({
    summary: { stage: "log_patterns", stage_index: 5, steps: 9, tool_calls: 27 },
    current_run: rcaRun(),
  }),
  history: [
    rcaRunItem({
      run_id: "run-2",
      trigger: "reanalyze",
      started_by: "a.rao@acme.io",
      state: "running",
      started_at: RCA_T0 + sec(120),
      ended_at: null,
    }),
    rcaRunItem(),
  ],
  threadRunId: "run-2",
  threadLive: true,
  ...overrides,
});

const completedProps = () => ({
  rca: rcaSummary({
    run_id: "run-1",
    state: "completed",
    started_at: RCA_T0,
    updated_at: RCA_T0 + sec(60),
    current_run: rcaRun({ run_id: "run-1", state: "completed", ended_at: RCA_T0 + sec(60) }),
  }),
  reportRun: rcaRunItem(),
  history: [rcaRunItem()],
  reportText: REPORT,
  threadRunId: "run-1",
  threadLive: false,
});

describe("IncidentRCAAnalysis", () => {
  let wrapper: VueWrapper;
  // The test setup installs a writable navigator.clipboard with a vi.fn writeText.
  const writeText = vi.mocked(navigator.clipboard.writeText);

  beforeEach(() => {
    getRcaThread.mockReset();
    getRcaThread.mockResolvedValue({ data: rcaThread() } as never);
    // Phase 2 cases: runs with no stored record (VE42).
    getRcaSummary.mockReset();
    answerSummary(rcaRunSummaryLegacy());
    writeText.mockReset().mockResolvedValue(undefined);
    getRcaSteering.mockReset().mockResolvedValue({ data: rcaSteering() } as never);
    steerRca.mockReset().mockResolvedValue({ data: { run_state: "running" } } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    toastMock.mockClear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("TH40 K: no run", () => {
    it("shows the Analyze button only, and emits a fresh trigger", async () => {
      wrapper = mountPanel({ rca: null });

      expect(byTest(wrapper, "rca-trigger-section").text()).toContain("No analysis yet");
      expect(byTest(wrapper, "rca-analysis-bar").exists()).toBe(false);
      expect(byTest(wrapper, "rca-verdict-card").exists()).toBe(false);
      expect(byTest(wrapper, "rca-thread-column").exists()).toBe(false);
      expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
      expect(byTest(wrapper, "trigger-rca-btn").text()).toBe("Analyze Incident");

      await byTest(wrapper, "trigger-rca-btn").trigger("click");

      expect(wrapper.emitted("trigger-rca")).toEqual([[{ buildOnPrevious: false }]]);
      expect(getRcaThread).not.toHaveBeenCalled();
    });
  });

  describe("E5 / TH36: one analysis column and the thread column, no view tabs", () => {
    it("has no Summary/Thread/Report tabs; bar, card, report in that order; thread on the right", async () => {
      wrapper = mountPanel(completedProps());
      await flushPromises();

      expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
      expect(wrapper.findAll('[role="tablist"]')).toHaveLength(0);
      const bar = byTest(wrapper, "rca-analysis-bar").element;
      const card = byTest(wrapper, "rca-verdict-card").element;
      const report = byTest(wrapper, "rca-existing-container").element;
      const column = byTest(wrapper, "rca-thread-column").element;
      expect(precedes(bar, card)).toBe(true);
      expect(precedes(card, report)).toBe(true);
      expect(precedes(report, column)).toBe(true);
      expect(report.textContent).toContain("Memory leak in the payment service.");
    });

    it('live with no earlier report: "The report shows after the run."', async () => {
      wrapper = mountPanel(liveProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-report-pending").text()).toBe("The report shows after the run.");
      expect(byTest(wrapper, "rca-existing-container").exists()).toBe(false);
    });

    it("live with an earlier report shows that report under the card, not the pending line", async () => {
      wrapper = mountPanel(liveProps({ reportRun: rcaRunItem(), reportText: REPORT }));
      await flushPromises();

      expect(byTest(wrapper, "rca-report-pending").exists()).toBe(false);
      expect(byTest(wrapper, "rca-existing-container").text()).toContain("Memory leak");
    });

    it("shows the analysis loading line until the summary answers, then the report loading line (legacy)", async () => {
      wrapper = mountPanel({ ...completedProps(), reportText: "", reportLoading: true });

      expect(byTest(wrapper, "rca-summary-loading").text()).toBe("Loading the analysis…");
      expect(byTest(wrapper, "rca-report-loading").exists()).toBe(false);
      await flushPromises();

      expect(byTest(wrapper, "rca-summary-loading").exists()).toBe(false);
      expect(byTest(wrapper, "rca-report-loading").text()).toBe("Loading report…");
      expect(byTest(wrapper, "rca-existing-container").exists()).toBe(false);
    });
  });

  describe("TH37: stage and stats", () => {
    it('shows "Stage 5/7 · Log patterns" and "9 checks · 27 tool calls · 4m12s", no credits', async () => {
      wrapper = mountPanel(liveProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-stage-label").text()).toBe("Stage 5/7 · Log patterns");
      expect(byTest(wrapper, "rca-thread-stats").text()).toBe("9 checks · 27 tool calls · 4m12s");
      expect(wrapper.text().toLowerCase()).not.toContain("credit");
    });

    it("hides the stepper once the run is not live", async () => {
      wrapper = mountPanel(completedProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-stage-stepper").exists()).toBe(false);
    });
  });

  describe("TH38: the thread column", () => {
    it("reads the thread of the run and shows it Live with its trigger", async () => {
      wrapper = mountPanel(liveProps());
      await flushPromises();

      expect(getRcaThread).toHaveBeenCalledWith("default", "inc-1", "run-2", undefined);
      expect(byTest(wrapper, "rca-thread-live-pill").text()).toBe("Live");
      expect(byTest(wrapper, "rca-thread-start-trigger").text()).toBe("Re-analyze by a.rao");
      expect(wrapper.findAll('[data-test="rca-thread-step"]')).toHaveLength(2);
    });

    it("shows Context used from the current run", async () => {
      wrapper = mountPanel(
        liveProps({
          rca: rcaSummary({
            current_run: rcaRun({
              context_used: { past_causes: [], skills: ["k8s"], toolsets: [] },
            }),
          }),
        }),
      );
      await flushPromises();

      expect(byTest(wrapper, "rca-thread-context-toggle").text()).toBe("Context used · 1 skill");
    });

    it("a completed run is Saved with the final note", async () => {
      getRcaThread.mockResolvedValue({
        data: rcaThread({ run_id: "run-1", active: false, steps: [rcaStep()] }),
      } as never);
      wrapper = mountPanel(completedProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-thread-saved-pill").text()).toBe("Saved");
      expect(byTest(wrapper, "rca-thread-final-note").exists()).toBe(true);
    });

    it("TH32: polls every 4 s while live and stops after one final read", async () => {
      vi.useFakeTimers();
      wrapper = mountPanel(liveProps());
      await vi.advanceTimersByTimeAsync(0);
      expect(getRcaThread).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(8_000);
      expect(getRcaThread).toHaveBeenCalledTimes(3);
      expect(getRcaThread.mock.calls[1][3]).toBe("12.100.200");

      await wrapper.setProps({
        rca: rcaSummary({ state: "completed", current_run: rcaRun({ state: "completed" }) }),
        threadLive: false,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getRcaThread).toHaveBeenCalledTimes(4);
    });

    it("TH32: a 410 shows the expired transcript and stops", async () => {
      getRcaThread.mockRejectedValue({ isAxiosError: true, response: { status: 410 } });
      wrapper = mountPanel(liveProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-thread-empty").text()).toBe(
        "The transcript of this run is no longer stored.",
      );
    });
  });

  describe("TH40 banners from the run summary", () => {
    // The suite pins TZ=UTC; a zone 5:30 ahead proves the banners format in UTC, not local time.
    beforeAll(() => {
      process.env.TZ = "Asia/Kolkata";
    });
    afterAll(() => {
      process.env.TZ = "UTC";
    });

    it("runs in a non-UTC local zone", () => {
      expect(formatTimestamp(RCA_T0, "HH:mm")).toBe("14:23");
    });

    it("M: a live re-run with an earlier report shows the re-analyzing banner", async () => {
      const reportRun = rcaRunItem();
      wrapper = mountPanel(
        liveProps({
          rca: rcaSummary({ current_run: rcaRun({ mode: "build_on_previous" }) }),
          reportRun,
          reportText: REPORT,
        }),
      );
      await flushPromises();

      expect(byTest(wrapper, "rca-reanalyzing-message").text()).toBe(
        "Building on the previous report…",
      );
      expect(byTest(wrapper, "rca-earlier-report-note").text()).toBe(
        "The report below is from the 08:53 UTC run.",
      );
      await byTest(wrapper, "rca-banner-cancel-btn").trigger("click");
      expect(wrapper.emitted("cancel-rca")).toHaveLength(1);
    });

    it("M: Follow in thread scrolls the thread column", async () => {
      const scrollTo = vi.fn();
      Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        value: scrollTo,
        configurable: true,
      });
      wrapper = mountPanel(liveProps({ reportRun: rcaRunItem(), reportText: REPORT }));
      await flushPromises();

      await byTest(wrapper, "rca-follow-thread-btn").trigger("click");
      await flushPromises();

      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
    });

    it("L: a failed run with an earlier report shows the reason, the report, and Retry modes", async () => {
      wrapper = mountPanel({
        rca: rcaSummary({
          state: "failed",
          current_run: rcaRun({ state: "failed", ended_at: RCA_T0 + sec(180) }),
        }),
        error: {
          code: "agent_unavailable",
          reason: "Agent unavailable",
          details: null,
          trigger_type: null,
        },
        reportRun: rcaRunItem(),
        reportText: REPORT,
        threadRunId: "run-2",
      });
      await flushPromises();

      expect(byTest(wrapper, "rca-error-reason").text()).toBe("Agent unavailable");
      expect(byTest(wrapper, "rca-existing-container").text()).toContain("Memory leak");
      await byTest(wrapper, "rca-retry-fresh").trigger("click");
      expect(wrapper.emitted("trigger-rca")).toEqual([[{ buildOnPrevious: false }]]);
    });

    it("N: the stale flag shows the stale warning with Cancel run", async () => {
      wrapper = mountPanel(liveProps({ rca: rcaSummary({ stale: true }), stale: true }));
      await flushPromises();

      expect(byTest(wrapper, "rca-stale-message").text()).toBe(
        "This analysis has been running unusually long and may have stopped. No new messages since 08:55:20 UTC. Cancel it and try again.",
      );
      await byTest(wrapper, "rca-stale-cancel-btn").trigger("click");
      expect(wrapper.emitted("cancel-rca")).toHaveLength(1);
    });

    it("E: names who cancelled, when, after how long, and the checks finished", async () => {
      // One finished step and one that never finished.
      getRcaThread.mockResolvedValue({ data: rcaThread({ active: false }) } as never);
      wrapper = mountPanel({
        rca: rcaSummary({
          state: "cancelled",
          current_run: rcaRun({
            state: "cancelled",
            cancelled_by: "a.rao@acme.io",
            ended_at: RCA_T0 + sec(180),
          }),
        }),
        threadRunId: "run-2",
      });
      await flushPromises();

      expect(byTest(wrapper, "rca-cancelled-message").text()).toBe(
        "Cancelled by a.rao at 08:56:20 UTC after 1m00s. 1 of 2 checks finished; the partial results below are not a verdict.",
      );
    });

    const cancelledProps = (summarySteps: number) => ({
      rca: rcaSummary({
        state: "cancelled",
        summary: { steps: summarySteps },
        current_run: rcaRun({
          state: "cancelled",
          cancelled_by: "a.rao@acme.io",
          ended_at: RCA_T0 + sec(180),
        }),
      }),
      threadRunId: "run-2",
    });

    const cancelledSentence = (done: number, total: number) =>
      `Cancelled by a.rao at 08:56:20 UTC after 1m00s. ${done} of ${total} checks finished; the partial results below are not a verdict.`;

    it("E (m1): a step cut off by the run's end does not count; m = max(thread steps, summary.steps)", async () => {
      const cut = rcaToolCall({ status: "error", error: RCA_UNFINISHED_TOOL_ERROR });
      getRcaThread.mockResolvedValue({
        data: rcaThread({
          active: false,
          report_submitted: false,
          // Every step closed by the projection; the third was cut off mid-call.
          steps: [
            rcaStep({ index: 1 }),
            rcaStep({ index: 2 }),
            rcaStep({ index: 3, tool_calls: [rcaToolCall(), cut] }),
          ],
        }),
      } as never);
      wrapper = mountPanel(cancelledProps(4));
      await flushPromises();

      expect(byTest(wrapper, "rca-cancelled-message").text()).toBe(cancelledSentence(2, 4));
    });

    it("E (m1): the thread's step count wins when the summary lags", async () => {
      getRcaThread.mockResolvedValue({ data: rcaThread({ active: false }) } as never);
      wrapper = mountPanel(cancelledProps(1));
      await flushPromises();

      expect(byTest(wrapper, "rca-cancelled-message").text()).toBe(cancelledSentence(1, 2));
    });

    it("E (m1): with no thread, n = m - 1 from the summary", async () => {
      getRcaThread.mockRejectedValue({ isAxiosError: true, response: { status: 410 } });
      wrapper = mountPanel(cancelledProps(5));
      await flushPromises();

      expect(byTest(wrapper, "rca-cancelled-message").text()).toBe(cancelledSentence(4, 5));
    });

    it("E (m1): with no thread and no steps, 0 of 0", async () => {
      getRcaThread.mockRejectedValue({ isAxiosError: true, response: { status: 410 } });
      wrapper = mountPanel(cancelledProps(0));
      await flushPromises();

      expect(byTest(wrapper, "rca-cancelled-message").text()).toBe(cancelledSentence(0, 0));
    });
  });

  describe("analysis bar", () => {
    it("the run selector lists the history; picking a completed run emits view-run", async () => {
      const history = [
        rcaRunItem({ run_id: "run-3", trigger: "reanalyze", started_by: "a.rao@acme.io" }),
        rcaRunItem({
          run_id: "run-2",
          trigger: "manual",
          started_by: "j.doe@acme.io",
          state: "failed",
        }),
        rcaRunItem({ run_id: "run-1", trigger: "auto_new_incident" }),
      ];
      wrapper = mountPanel({
        ...completedProps(),
        rca: rcaSummary({ run_id: "run-3", state: "completed" }),
        history,
      });
      await flushPromises();

      expect(byTest(wrapper, "rca-history-item-1").attributes("data-disabled")).toBe("true");
      await byTest(wrapper, "rca-history-item-2").trigger("click");
      await byTest(wrapper, "rca-history-item-0").trigger("click");
      expect(wrapper.emitted("view-run")).toEqual([["run-1"], [null]]);
    });

    it("a picked completed run shows as Analyzed while the latest run failed", async () => {
      const viewedRun = rcaRunItem();
      wrapper = mountPanel({
        rca: rcaSummary({ state: "failed", current_run: rcaRun({ state: "failed" }) }),
        error: { code: "x", reason: "Boom", details: null, trigger_type: null },
        viewedRun,
        reportRun: viewedRun,
        history: [rcaRunItem({ run_id: "run-2", state: "failed" }), viewedRun],
        reportText: REPORT,
        threadRunId: "run-1",
      });
      await flushPromises();

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Analyzed");
      expect(byTest(wrapper, "rca-error-banner").exists()).toBe(false);
      expect(byTest(wrapper, "rca-run-selector-label").text()).toBe("Run 1 · Oct 9, 08:53 UTC");
      expect(getRcaThread).toHaveBeenCalledWith("default", "inc-1", "run-1", undefined);
    });

    it("the subtitle names the trigger and age", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: (RCA_T0 + sec(127)) / 1000 });
      wrapper = mountPanel(liveProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-analysis-subtitle").text()).toBe(
        "Re-analyze by a.rao · started 7s ago",
      );
    });

    it("Re-analyze emits the chosen mode", async () => {
      wrapper = mountPanel(completedProps());
      await flushPromises();

      await byTest(wrapper, "rca-reanalyze-build").trigger("click");
      expect(wrapper.emitted("trigger-rca")).toEqual([[{ buildOnPrevious: true }]]);
    });

    it("Cancel run emits cancel-rca while live", async () => {
      wrapper = mountPanel(liveProps());
      await flushPromises();

      await byTest(wrapper, "rca-cancel-btn").trigger("click");
      expect(wrapper.emitted("cancel-rca")).toHaveLength(1);
    });
  });

  describe("v1: pre-upgrade reports", () => {
    const V1 = rcaV1RunItem();
    const OLDER_V1 = rcaV1RunItem({
      run_id: "v1-1",
      started_at: RCA_T0 - sec(3600),
      ended_at: RCA_T0 - sec(3600),
    });
    const NO_TRANSCRIPT = "This run has no stored transcript.";

    beforeEach(() => {
      getRcaFeedback.mockReset().mockResolvedValue({ data: { items: [], mine: null } } as never);
    });

    const expectNoRunReads = () => {
      expect(getRcaThread).not.toHaveBeenCalled();
      expect(getRcaSummary).not.toHaveBeenCalled();
      expect(getRcaSteering).not.toHaveBeenCalled();
      expect(getRcaFeedback).not.toHaveBeenCalled();
    };

    it("a v1-only incident shows the Analyzed card and the report, and reads no run record", async () => {
      wrapper = mountPanel({
        rca: rcaV1Summary([V1, OLDER_V1]),
        reportRun: V1,
        history: [V1, OLDER_V1],
        reportText: REPORT,
        threadRunId: "v1-0",
        threadLive: false,
      });
      await flushPromises();

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Analyzed");
      expect(byTest(wrapper, "rca-existing-container").text()).toContain("Memory leak");
      expect(byTest(wrapper, "rca-summary-loading").exists()).toBe(false);
      expect(byTest(wrapper, "rca-thread-empty").text()).toBe(NO_TRANSCRIPT);
      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(false);
      expect(byTest(wrapper, "rca-resume-btn").exists()).toBe(false);
      expect(byTest(wrapper, "rca-reanalyze-build").attributes("data-disabled")).toBe("false");
      expectNoRunReads();
    });

    it("a failed latest run with a v1 report shows the v1 report as the earlier report", async () => {
      const failed = rcaRunItem({
        run_id: "run-1",
        state: "failed",
        started_at: RCA_T0 + sec(600),
        ended_at: RCA_T0 + sec(700),
      });
      wrapper = mountPanel({
        rca: rcaSummary({
          run_id: "run-1",
          state: "failed",
          current_run: rcaRun({ run_id: "run-1", state: "failed" }),
          report_run: V1,
          history: [failed, V1],
        }),
        error: {
          code: "agent_unavailable",
          reason: "Agent unavailable",
          details: null,
          trigger_type: null,
        },
        reportRun: V1,
        history: [failed, V1],
        reportText: REPORT,
        threadRunId: "run-1",
      });
      await flushPromises();

      expect(byTest(wrapper, "rca-error-reason").text()).toBe("Agent unavailable");
      expect(byTest(wrapper, "rca-earlier-report-note").text()).toBe(
        "The report below is from the 08:53 UTC run.",
      );
      expect(byTest(wrapper, "rca-existing-container").text()).toContain("Memory leak");
      expect(getRcaThread).toHaveBeenCalledWith("default", "inc-1", "run-1", undefined);
      expect(getRcaThread).not.toHaveBeenCalledWith("default", "inc-1", "v1-0", undefined);
    });

    it("the selector opens a v1 report; the picked v1 run shows its report and reads no thread", async () => {
      answerSummary(rcaRunSummary());
      wrapper = mountPanel({ ...completedProps(), history: [rcaRunItem(), V1] });
      await flushPromises();
      expect(byTest(wrapper, "rca-what-happened").exists()).toBe(true);

      expect(byTest(wrapper, "rca-history-item-1").attributes("data-disabled")).toBe("false");
      await byTest(wrapper, "rca-history-item-1").trigger("click");
      expect(wrapper.emitted("view-run")).toEqual([["v1-0"]]);

      getRcaThread.mockClear();
      getRcaSummary.mockClear();
      getRcaSteering.mockClear();
      getRcaFeedback.mockClear();
      await wrapper.setProps({
        viewedRun: V1,
        threadRunId: "v1-0",
        reportText: "## Root Cause\n\nDisk full on the ledger node.",
      });
      await flushPromises();

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Analyzed");
      expect(byTest(wrapper, "rca-what-happened").exists()).toBe(false);
      expect(byTest(wrapper, "rca-existing-container").text()).toContain("Disk full");
      expect(byTest(wrapper, "rca-thread-empty").text()).toBe(NO_TRANSCRIPT);
      expectNoRunReads();
    });
  });

  describe("⋯ menu (E5)", () => {
    it("Copy report puts the markdown on the clipboard", async () => {
      wrapper = mountPanel(completedProps());
      await flushPromises();

      await byTest(wrapper, "rca-copy-btn").trigger("click");
      await flushPromises();

      expect(writeText).toHaveBeenCalledWith(REPORT);
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    });

    it("Download as Markdown writes a .md file with the same text", async () => {
      const createObjectURL = vi.mocked(URL.createObjectURL);
      createObjectURL.mockClear().mockReturnValueOnce("blob:rca");
      vi.mocked(URL.revokeObjectURL).mockClear();
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      wrapper = mountPanel(completedProps());
      await flushPromises();

      await byTest(wrapper, "rca-download-btn").trigger("click");

      expect(click).toHaveBeenCalledTimes(1);
      const anchor = click.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.download).toBe("incident-inc-1-rca.md");
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe("text/markdown;charset=utf-8");
      // jsdom's Blob has no text(); FileReader reads it.
      const reader = new FileReader();
      const read = Promise.withResolvers<void>();
      reader.onload = () => read.resolve();
      reader.readAsText(blob);
      await read.promise;
      expect(reader.result).toBe(REPORT);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:rca");
    });

    it("Copy thread puts the plain-text transcript on the clipboard", async () => {
      wrapper = mountPanel(liveProps());
      await flushPromises();

      await byTest(wrapper, "rca-copy-thread-btn").trigger("click");
      await flushPromises();

      expect(writeText).toHaveBeenCalledWith(
        rcaThreadPlainText(rcaThread(), "Investigation thread"),
      );
      expect(toastMock).toHaveBeenCalledWith({
        variant: "success",
        message: "Thread copied to clipboard",
      });
    });

    it("a clipboard failure shows the failure toast", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      writeText.mockRejectedValue(new Error("denied"));
      wrapper = mountPanel(liveProps());
      await flushPromises();

      await byTest(wrapper, "rca-copy-thread-btn").trigger("click");
      await flushPromises();

      expect(toastMock).toHaveBeenCalledWith({
        variant: "error",
        message: "Failed to copy thread",
      });
    });

    it("Copy thread is disabled when the run has no transcript", async () => {
      getRcaThread.mockResolvedValue({
        data: rcaThread({ transcript: "none", steps: [], started: null }),
      } as never);
      wrapper = mountPanel(completedProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-copy-thread-btn").attributes("data-disabled")).toBe("true");
      expect(byTest(wrapper, "rca-thread-empty").text()).toBe("This run has no stored transcript.");
    });
  });

  describe("review fixes", () => {
    it("Build on previous is enabled by a completed run even while its report text loads", async () => {
      wrapper = mountPanel({ ...completedProps(), reportText: "", reportLoading: true });
      await flushPromises();

      expect(byTest(wrapper, "rca-reanalyze-build").attributes("data-disabled")).toBe("false");
      // Copy/Download still need the text.
      expect(byTest(wrapper, "rca-copy-btn").attributes("data-disabled")).toBe("true");
    });

    it("Build on previous is disabled without a completed run", async () => {
      wrapper = mountPanel({
        rca: rcaSummary({ state: "failed", current_run: rcaRun({ state: "failed" }) }),
        error: { code: "x", reason: "Boom", details: null, trigger_type: null },
        threadRunId: "run-2",
      });
      await flushPromises();

      expect(byTest(wrapper, "rca-reanalyze-build").attributes("data-disabled")).toBe("true");
    });

    const statsProps = () => ({
      ...completedProps(),
      rca: rcaSummary({
        run_id: "run-1",
        state: "completed",
        current_run: rcaRun({
          run_id: "run-1",
          state: "completed",
          stats: { steps: 5, tool_calls: 11, duration_ms: 107_000 },
        }),
      }),
    });

    it.each([
      [
        "transcript none",
        () =>
          getRcaThread.mockResolvedValue({
            data: rcaThread({ run_id: "run-1", transcript: "none", steps: [], started: null }),
          } as never),
      ],
      [
        "410",
        () => getRcaThread.mockRejectedValue({ isAxiosError: true, response: { status: 410 } }),
      ],
      [
        "410 transcript_incomplete",
        () =>
          getRcaThread.mockRejectedValue({
            isAxiosError: true,
            response: { status: 410, data: { error_code: "transcript_incomplete" } },
          }),
      ],
      [
        "503",
        () => {
          vi.spyOn(console, "error").mockImplementation(() => {});
          getRcaThread.mockRejectedValue({ isAxiosError: true, response: { status: 503 } });
        },
      ],
    ])("m5: the stats line falls back to the run's stats for %s", async (_case, arrange) => {
      arrange();
      wrapper = mountPanel(statsProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-thread-stats").text()).toBe("5 checks · 11 tool calls · 1m47s");
    });

    it("a 410 transcript_incomplete shows the incomplete message, not the expired one", async () => {
      getRcaThread.mockRejectedValue({
        isAxiosError: true,
        response: { status: 410, data: { error_code: "transcript_incomplete" } },
      });
      wrapper = mountPanel(statsProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-thread-empty").text()).toBe(
        "Part of this run's transcript was lost, so the thread cannot be shown.",
      );
      expect(byTest(wrapper, "rca-thread-retry-btn").exists()).toBe(false);
      expect(getRcaThread).toHaveBeenCalledTimes(1);
    });

    it("Retry: a saved run whose thread read failed re-reads once on Retry", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      getRcaThread
        .mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
        .mockResolvedValue({ data: rcaThread({ run_id: "run-1", active: false }) } as never);
      wrapper = mountPanel(completedProps());
      await flushPromises();
      expect(byTest(wrapper, "rca-thread-empty").text()).toContain(
        "The thread could not be loaded.",
      );

      await byTest(wrapper, "rca-thread-retry-btn").trigger("click");
      await flushPromises();

      expect(getRcaThread).toHaveBeenCalledTimes(2);
      expect(getRcaThread).toHaveBeenLastCalledWith("default", "inc-1", "run-1", undefined);
      expect(byTest(wrapper, "rca-thread-retry-btn").exists()).toBe(false);
      expect(wrapper.findAll('[data-test="rca-thread-step"]')).toHaveLength(2);
    });

    it("Retry is not offered while the run is live (its poll retries)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      getRcaThread.mockRejectedValue({ isAxiosError: true, response: { status: 503 } });
      wrapper = mountPanel(liveProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-thread-retry-btn").exists()).toBe(false);
    });
  });

  describe("Phase 3: summary sections (F1, VE36, VE42)", () => {
    const SECTIONS = [
      "rca-what-happened",
      "rca-hypotheses",
      "rca-blind-spots",
      "rca-evidence-list",
    ] as const;

    const shownSections = (w: VueWrapper) => SECTIONS.filter((id) => byTest(w, id).exists());

    it("a graded run shows its verdict and structured sections instead of the markdown report", async () => {
      answerSummary(rcaRunSummary());
      wrapper = mountPanel(completedProps());
      await flushPromises();

      expect(getRcaSummary).toHaveBeenCalledWith("default", "inc-1", "run-1", undefined);
      for (const id of SECTIONS) expect(byTest(wrapper, id).exists()).toBe(true);
      expect(byTest(wrapper, "rca-existing-container").exists()).toBe(false);
      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Root cause identified");
      expect(byTest(wrapper, "rca-verdict-band").text()).toContain("High");
      // Copy report stays in the ⋯ menu.
      expect(byTest(wrapper, "rca-copy-btn").attributes("data-disabled")).toBe("false");
    });

    it("legacy (VE42): the Analyzed card and the markdown report, none of the new sections", async () => {
      wrapper = mountPanel(completedProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Analyzed");
      expect(byTest(wrapper, "rca-verdict-band").exists()).toBe(false);
      expect(byTest(wrapper, "rca-existing-container").text()).toContain("Memory leak");
      expect(shownSections(wrapper)).toEqual([]);
    });

    it("a finished run whose summary cannot be read falls back to the markdown report (F1)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      getRcaSummary.mockRejectedValue({ isAxiosError: true, response: { status: 503 } });
      wrapper = mountPanel(completedProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-existing-container").text()).toContain("Memory leak");
      expect(shownSections(wrapper)).toEqual([]);
    });

    it("completed with a record but no outcome: Analyzed with no band, the sections, no markdown", async () => {
      const base = rcaRunSummary();
      answerSummary(
        rcaRunSummary({ card: { ...base.card, outcome: undefined, outcome_reason: undefined } }),
      );
      wrapper = mountPanel(completedProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Analyzed");
      expect(byTest(wrapper, "rca-verdict-band").exists()).toBe(false);
      expect(shownSections(wrapper)).toEqual([...SECTIONS]);
      expect(byTest(wrapper, "rca-existing-container").exists()).toBe(false);
    });

    it("A live: Leading card with no band; the timeline comes with the report; groups read Being tested", async () => {
      answerSummary(rcaRunSummaryLive());
      wrapper = mountPanel(liveProps());
      await flushPromises();

      expect(getRcaSummary).toHaveBeenCalledWith("default", "inc-1", "run-2", undefined);
      expect(byTest(wrapper, "rca-verdict-headline").text()).toBe(
        "Leading: Deploy 4f2c1e exhausted the orders-db pool",
      );
      expect(byTest(wrapper, "rca-verdict-qualifier").text()).toContain("Revised · was “");
      expect(byTest(wrapper, "rca-verdict-band").exists()).toBe(false);
      expect(byTest(wrapper, "rca-verdict-facts").exists()).toBe(false);
      expect(byTest(wrapper, "rca-timeline-pending").text()).toBe(
        "The causal timeline comes with the report.",
      );
      expect(byTest(wrapper, "rca-hypotheses").text()).toContain("Being tested");
      expect(byTest(wrapper, "rca-report-pending").exists()).toBe(false);
    });

    it("polls the summary with the thread while live, then one final read (03 §12)", async () => {
      vi.useFakeTimers();
      getRcaSummary
        .mockResolvedValueOnce({ data: rcaRunSummaryLive({ state_version: "s1" }) } as never)
        .mockResolvedValue({
          data: { run_id: "run-2", not_modified: true, state_version: "s1" },
        } as never);
      wrapper = mountPanel(liveProps());
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(getRcaSummary).toHaveBeenCalledTimes(3);
      expect(getRcaSummary.mock.calls[2][3]).toBe("s1");

      await wrapper.setProps({
        rca: rcaSummary({ state: "completed", current_run: rcaRun({ state: "completed" }) }),
        threadLive: false,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getRcaSummary).toHaveBeenCalledTimes(4);
    });

    it("waiting_input: the pill reads 'Blocked · waiting for an answer'", async () => {
      answerSummary(rcaRunSummaryLive({ state: "waiting_input" }));
      wrapper = mountPanel(liveProps({ rca: rcaSummary({ state: "waiting_input" }) }));
      await flushPromises();

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Blocked · waiting for an answer");
    });

    it("D blocked: 'Needs: Change history' and the blind spot's button", async () => {
      answerSummary(rcaRunSummaryBlocked());
      wrapper = mountPanel(completedProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Blocked");
      expect(byTest(wrapper, "rca-verdict-below").text()).toBe("Needs: Change history");
      expect(byTest(wrapper, "rca-blind-spot-action").text()).toBe("Connect AI Toolset");
    });

    it("E cancelled with a partial record: no timeline, hypotheses, the run_end blind spot with no button", async () => {
      answerSummary(rcaRunSummaryCancelled());
      getRcaThread.mockResolvedValue({ data: rcaThread({ active: false }) } as never);
      wrapper = mountPanel({
        rca: rcaSummary({
          state: "cancelled",
          current_run: rcaRun({ state: "cancelled", ended_at: RCA_T0 + sec(180) }),
        }),
        threadRunId: "run-2",
      });
      await flushPromises();

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Failed");
      expect(byTest(wrapper, "rca-verdict-headline").text()).toBe(
        "Run cancelled before a verdict. Partial results below",
      );
      expect(byTest(wrapper, "rca-verdict-band").text()).toBe("No confidence");
      expect(shownSections(wrapper)).toEqual([
        "rca-hypotheses",
        "rca-blind-spots",
        "rca-evidence-list",
      ]);
      expect(byTest(wrapper, "rca-blind-spot").text()).toContain("3 stages did not run");
      expect(byTest(wrapper, "rca-blind-spot-action").exists()).toBe(false);
    });

    it("F9: a thread chip shows the entry number and opens that entry in the Evidence index", async () => {
      Element.prototype.scrollIntoView = vi.fn();
      answerSummary(rcaRunSummary({ evidence: [rcaEvidenceEntry({ number: 1, ids: ["e3"] })] }));
      getRcaThread.mockResolvedValue({
        data: rcaThread({ run_id: "run-1", active: false, steps: [rcaStep()] }),
      } as never);
      wrapper = mountPanel(completedProps());
      await flushPromises();

      const step = byTest(wrapper, "rca-thread-step");
      expect(step.find('[data-test="rca-citation-unverified"]').text()).toBe("e7 · not verified");
      const chip = step.find('[data-test="rca-citation-chip"]');
      expect(chip.text()).toBe("1");
      expect(
        wrapper.find('[data-test="rca-evidence-list"] [data-test="rca-evidence-card"]').exists(),
      ).toBe(false);

      await chip.trigger("click");
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="rca-evidence-list"] [data-number="1"] [data-test="rca-evidence-card"]')
          .exists(),
      ).toBe(true);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it("the band chip opens 'Cited but not verified' (VE33)", async () => {
      Element.prototype.scrollIntoView = vi.fn();
      answerSummary(rcaRunSummary());
      wrapper = mountPanel(completedProps());
      await flushPromises();

      await byTest(wrapper, "rca-verdict-band").trigger("click");
      await flushPromises();

      expect(document.activeElement).toBe(byTest(wrapper, "rca-unverified").element);
    });

    it("a 410 on the summary of a live run leaves the card in its Phase 2 form and stops", async () => {
      getRcaSummary.mockRejectedValue({ isAxiosError: true, response: { status: 410 } });
      wrapper = mountPanel(liveProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-verdict-headline").text()).toBe("Investigating");
      expect(shownSections(wrapper)).toEqual([]);
      expect(getRcaSummary).toHaveBeenCalledTimes(1);
    });

    it("the run ends and its final summary read fails: the live view goes and the markdown report shows (F1)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      getRcaSummary
        .mockResolvedValueOnce({ data: rcaRunSummaryLive() } as never)
        .mockRejectedValue({ isAxiosError: true, response: { status: 503 } });
      wrapper = mountPanel(liveProps());
      await flushPromises();
      expect(byTest(wrapper, "rca-verdict-headline").text()).toContain("Leading: ");

      await wrapper.setProps({
        rca: rcaSummary({ state: "completed", current_run: rcaRun({ state: "completed" }) }),
        reportRun: rcaRunItem({ run_id: "run-2" }),
        reportText: REPORT,
        threadLive: false,
      });
      await flushPromises();

      expect(getRcaSummary).toHaveBeenCalledTimes(2);
      expect(shownSections(wrapper)).toEqual([]);
      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Analyzed");
      expect(byTest(wrapper, "rca-verdict-headline").text()).not.toContain("Leading");
      expect(byTest(wrapper, "rca-existing-container").text()).toContain("Memory leak");
    });

    it("F9: a thread chip for an id reused by a later entry opens the first entry (VE5, VE24)", async () => {
      Element.prototype.scrollIntoView = vi.fn();
      answerSummary(
        rcaRunSummary({
          evidence: [
            rcaEvidenceEntry({ number: 1, ids: ["e3"] }),
            rcaEvidenceEntry({ number: 2, ids: ["e3", "e7"], call_id: "call-9" }),
          ],
        }),
      );
      getRcaThread.mockResolvedValue({
        data: rcaThread({ run_id: "run-1", active: false, steps: [rcaStep()] }),
      } as never);
      wrapper = mountPanel(completedProps());
      await flushPromises();

      const chips = byTest(wrapper, "rca-thread-step").findAll('[data-test="rca-citation-chip"]');
      expect(chips.map((chip) => chip.text())).toEqual(["1", "2"]);

      await chips[0].trigger("click");
      await flushPromises();

      const list = byTest(wrapper, "rca-evidence-list");
      expect(list.find('[data-number="1"] [data-test="rca-evidence-card"]').exists()).toBe(true);
      expect(list.find('[data-number="2"] [data-test="rca-evidence-card"]').exists()).toBe(false);
    });
  });

  describe("04 steering (SG37–SG40, H16)", () => {
    // ODialog portals; the stub keeps the guidance dialog's body in the wrapper.
    const ODialogStub = {
      name: "ODialog",
      props: ["open"],
      emits: ["update:open", "click:primary", "click:secondary"],
      // The dialog's own data-test falls through onto this root.
      template: `<div v-if="open"><slot /></div>`,
    };
    const mountSteerable = (props: Record<string, unknown>) =>
      mount(IncidentRCAAnalysis, {
        props: { orgId: "default", incidentId: "inc-1", ...props },
        global: { plugins: [i18n, store], stubs: { ...stubs, ODialog: ODialogStub } },
        attachTo: document.body,
      });
    const pausedProps = () =>
      liveProps({
        rca: rcaSummary({
          state: "waiting_input",
          summary: { stage: "log_patterns", stage_index: 5, steps: 9, tool_calls: 27 },
          current_run: rcaRun({ state: "waiting_input" }),
        }),
      });

    it("SG37: reads the steering view of the thread's run; can_steer shows the composer", async () => {
      wrapper = mountSteerable(liveProps());
      await flushPromises();

      expect(getRcaSteering).toHaveBeenCalledWith("default", "inc-1", "run-2");
      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(true);
    });

    it("SG37: a reader without RCA permission (403) sees the thread and no composer", async () => {
      getRcaSteering.mockRejectedValue({ isAxiosError: true, response: { status: 403, data: {} } });
      wrapper = mountSteerable(liveProps());
      await flushPromises();

      expect(wrapper.findAll('[data-test="rca-thread-step"]')).toHaveLength(2);
      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(false);
      expect(byTest(wrapper, "rca-thread-final-note").exists()).toBe(false);
    });

    it("SG37: can_steer false hides the composer on a live run", async () => {
      getRcaSteering.mockResolvedValue({ data: rcaSteering({ can_steer: false }) } as never);
      wrapper = mountSteerable(liveProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(false);
    });

    it("send: POSTs the message, then re-reads the steering view at once", async () => {
      wrapper = mountSteerable(liveProps());
      await flushPromises();
      const reads = getRcaSteering.mock.calls.length;

      await wrapper.find('[data-test="rca-steer-composer"] textarea').setValue("Check the pool");
      await wrapper.find('[data-test="rca-steer-composer"]').trigger("submit");
      await flushPromises();

      expect(steerRca).toHaveBeenCalledWith("default", "inc-1", "run-2", {
        text: "Check the pool",
        kind: "message",
      });
      expect(getRcaSteering.mock.calls.length).toBe(reads + 1);
    });

    it("SG40: a run_closing 409 keeps the text visible after the poll hides the composer", async () => {
      vi.useFakeTimers();
      wrapper = mountSteerable(pausedProps());
      await vi.advanceTimersByTimeAsync(0);
      steerRca.mockRejectedValue({
        isAxiosError: true,
        response: { status: 409, data: { error_code: "run_closing" } },
      });

      await wrapper.find('[data-test="rca-steer-composer"] textarea').setValue("PR #812 at 14:02");
      await wrapper.find('[data-test="rca-steer-composer"]').trigger("submit");
      await vi.advanceTimersByTimeAsync(0);
      // A closed run is not re-read at once; the next 4 s poll closes the box.
      getRcaSteering.mockResolvedValue({ data: rcaSteering({ can_steer: false }) } as never);
      await vi.advanceTimersByTimeAsync(RCA_STEERING_POLL_MS);

      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(false);
      expect(byTest(wrapper, "rca-thread-refusal-text").text()).toBe("PR #812 at 14:02");
      await byTest(wrapper, "rca-thread-refusal-reanalyze").trigger("click");
      expect(
        (wrapper.find('[data-test="rca-guidance-dialog"] textarea').element as HTMLTextAreaElement)
          .value,
      ).toBe("PR #812 at 14:02");
    });

    it("SG40 race: a steering read hides the composer before the refused send settles; the text stays", async () => {
      wrapper = mountSteerable(pausedProps());
      await flushPromises();
      let refuse!: () => void;
      steerRca.mockReturnValue(
        new Promise((_resolve, reject) => {
          refuse = () =>
            reject({
              isAxiosError: true,
              response: { status: 409, data: { error_code: "run_closing" } },
            });
        }) as never,
      );
      getRcaSteering.mockResolvedValue({ data: rcaSteering({ can_steer: false }) } as never);

      await wrapper.find('[data-test="rca-steer-composer"] textarea').setValue("PR #812 at 14:02");
      await wrapper.find('[data-test="rca-steer-composer"]').trigger("submit");
      // The run stops being live: its final steering read closes the box first.
      await wrapper.setProps({ threadLive: false });
      await flushPromises();
      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(false);

      refuse();
      await flushPromises();

      expect(byTest(wrapper, "rca-thread-refusal-text").text()).toBe("PR #812 at 14:02");
      expect(byTest(wrapper, "rca-thread-refusal").text()).toContain(
        "The answer window has closed and the run is closing as Blocked.",
      );
    });

    it("SG40: 'Re-analyze with this message' opens frame I with the text; Start sends {guidance}", async () => {
      getRcaSteering.mockResolvedValue({
        data: rcaSteering({
          items: [
            rcaSteerRecord({
              text: "Check PR #812",
              status: "rejected",
              status_reason: "finalizing",
            }),
          ],
        }),
      } as never);
      wrapper = mountSteerable(liveProps());
      await flushPromises();
      expect(byTest(wrapper, "rca-guidance-dialog").exists()).toBe(false);

      await byTest(wrapper, "rca-thread-steer-reanalyze").trigger("click");

      const dialog = byTest(wrapper, "rca-guidance-dialog");
      expect((dialog.find("textarea").element as HTMLTextAreaElement).value).toBe("Check PR #812");
      expect(dialog.text()).toContain("Creates a new report version. This one stays as is.");
      await wrapper.findComponent(ODialogStub).vm.$emit("click:primary");
      expect(wrapper.emitted("trigger-rca")).toEqual([
        [{ buildOnPrevious: false, guidance: "Check PR #812" }],
      ]);
    });

    it("frame I: the Re-analyze menu's 'With guidance…' opens the dialog empty", async () => {
      wrapper = mountSteerable(completedProps());
      await flushPromises();

      await byTest(wrapper, "rca-reanalyze-guidance").trigger("click");

      const dialog = byTest(wrapper, "rca-guidance-dialog");
      expect((dialog.find("textarea").element as HTMLTextAreaElement).value).toBe("");
    });

    it("SG39 frame D: paused banner with the step and the local deadline; 'Waiting for an answer'", async () => {
      getRcaThread.mockResolvedValue({
        data: rcaThread({ questions: [rcaThreadQuestion()] }),
      } as never);
      getRcaSteering.mockResolvedValue({ data: rcaSteeringPaused() } as never);
      wrapper = mountSteerable(pausedProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-paused-title").text()).toBe(
        "Paused after “Map the checkout dependencies”",
      );
      // RCA_T0 + 30 min in the store's UTC zone.
      expect(byTest(wrapper, "rca-paused-deadline").text()).toBe(
        "The agent waits until 09:23 for an answer, then closes the run as Blocked.",
      );
      expect(byTest(wrapper, "rca-thread-question-status").text()).toBe("Waiting for an answer");
      expect(byTest(wrapper, "rca-steer-question").text()).toContain("Agent asks:");
    });

    it("SG39 frame G: 'Unblocked by <author> at <read_at>' and 'Answered by <author>'", async () => {
      getRcaThread.mockResolvedValue({
        data: rcaThread({
          run_id: "run-1",
          active: false,
          steps: [rcaStep()],
          questions: [rcaThreadQuestion()],
        }),
      } as never);
      getRcaSteering.mockResolvedValue({ data: rcaSteeringUnblocked() } as never);
      answerSummary(rcaRunSummary());
      wrapper = mountSteerable(completedProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-verdict-unblocked").text()).toBe(
        "Unblocked by a.rao at 08:58 · change history from a human lead",
      );
      expect(byTest(wrapper, "rca-thread-question-status").text()).toBe("Answered by a.rao");
    });

    it("H16: a hypothesis action POSTs its body; the row shows 'Pending · <author>' until read", async () => {
      answerSummary(rcaRunSummaryLive());
      wrapper = mountSteerable(liveProps());
      await flushPromises();
      getRcaSteering.mockResolvedValue({
        data: rcaSteering({
          items: [
            rcaSteerRecord({
              kind: "hypothesis_action",
              action: "disprove",
              hypothesis_id: "h1",
              text: "Disprove h1",
            }),
          ],
        }),
      } as never);

      await wrapper.find('[data-test="rca-hypothesis-action-disprove"]').trigger("click");
      await flushPromises();

      expect(steerRca).toHaveBeenCalledWith("default", "inc-1", "run-2", {
        text: "",
        kind: "hypothesis_action",
        action: "disprove",
        hypothesis_id: "h1",
      });
      expect(byTest(wrapper, "rca-hypothesis-pending").text()).toBe("Pending · a.rao");
    });
  });

  describe("Phase 5: Ask, Resume, Feedback", () => {
    const original = {
      isEnterprise: awsConfig.isEnterprise,
      isCloud: awsConfig.isCloud,
      ai: store.state.zoConfig.ai_enabled,
    };

    beforeEach(() => {
      awsConfig.isEnterprise = "true";
      awsConfig.isCloud = "false";
      store.state.zoConfig.ai_enabled = true;
      getRcaFeedback.mockReset().mockResolvedValue({ data: { items: [], mine: null } } as never);
    });

    afterEach(() => {
      awsConfig.isEnterprise = original.isEnterprise;
      awsConfig.isCloud = original.isCloud;
      store.state.zoConfig.ai_enabled = original.ai;
    });

    const askPayloads = (w: VueWrapper) => w.emitted<[RcaAskPayload]>("ask-ai") ?? [];

    describe("J5 Ask", () => {
      it("a finished run with a report: Ask emits the hand-off payload for a new, unsent chat", async () => {
        wrapper = mountPanel({ ...completedProps(), incidentTitle: "checkout 5xx" });
        await flushPromises();

        await byTest(wrapper, "rca-ask-btn").trigger("click");

        const events = askPayloads(wrapper);
        expect(events).toHaveLength(1);
        const [payload] = events[0];
        expect(Object.keys(payload).sort()).toEqual(
          ["autoSend", "chipName", "context", "newChat", "query"].sort(),
        );
        expect(payload.newChat).toBe(true);
        expect(payload.autoSend).toBe(false);
        // The chip names the run as the selector does.
        const runLabel = byTest(wrapper, "rca-run-selector-label").text();
        expect(payload.chipName).toBe(`Analysis · ${runLabel}`);
        // No incident or run keys: they would route the chat to the RCA agent.
        expect(payload.context).toEqual({ currentPage: "incidents", org_id: "default" });
        expect(payload.query).toContain("inc-1 (checkout 5xx)");
        expect(payload.query).toContain("run-1");
        expect(payload.query.endsWith("Memory leak in the payment service.")).toBe(true);
      });

      it("a run with a record: the attachment carries the structured record", async () => {
        answerSummary(rcaRunSummary());
        wrapper = mountPanel(completedProps());
        await flushPromises();

        await byTest(wrapper, "rca-ask-btn").trigger("click");

        const [[payload]] = askPayloads(wrapper);
        expect(payload.query).toContain("## Verdict");
        expect(payload.query).toContain("## Evidence");
        expect(payload.query).toContain("## Report");
      });

      it("a live run with no earlier report offers no Ask", async () => {
        wrapper = mountPanel(liveProps());
        await flushPromises();

        expect(byTest(wrapper, "rca-ask-btn").exists()).toBe(false);
      });

      it.each([
        ["AI disabled on the server", () => (store.state.zoConfig.ai_enabled = false)],
        ["an edition without the AI assistant", () => (awsConfig.isEnterprise = "false")],
      ])("%s: no Ask", async (_label, disable) => {
        disable();
        wrapper = mountPanel(completedProps());
        await flushPromises();

        expect(byTest(wrapper, "rca-ask-btn").exists()).toBe(false);
      });

      it("a picked earlier run: Ask is about that run", async () => {
        const viewedRun = rcaRunItem();
        wrapper = mountPanel({
          rca: rcaSummary({ state: "failed", current_run: rcaRun({ state: "failed" }) }),
          error: { code: "x", reason: "Boom", details: null, trigger_type: null },
          viewedRun,
          reportRun: viewedRun,
          history: [rcaRunItem({ run_id: "run-2", state: "failed" }), viewedRun],
          reportText: REPORT,
          threadRunId: "run-1",
        });
        await flushPromises();

        await byTest(wrapper, "rca-ask-btn").trigger("click");

        const [[payload]] = askPayloads(wrapper);
        expect(payload.chipName).toBe("Analysis · Run 1 · Oct 9, 08:53 UTC");
        expect(payload.query).toContain("Run: run-1");
        expect(payload.query).not.toContain("run-2");
      });
    });

    describe("J9 Resume", () => {
      const failedProps = (overrides: Record<string, unknown> = {}) => ({
        rca: rcaSummary({
          state: "failed",
          current_run: rcaRun({ state: "failed", ended_at: RCA_T0 + sec(180) }),
        }),
        error: { code: "timeout", reason: "Timed out", details: null, trigger_type: null },
        history: [rcaRunItem({ run_id: "run-2", state: "failed" }), rcaRunItem()],
        reportRun: rcaRunItem(),
        reportText: REPORT,
        threadRunId: "run-2",
        ...overrides,
      });

      it("Resume run on the L banner emits resume-rca with the resumable run id", async () => {
        wrapper = mountPanel(failedProps({ resumeRunId: "run-src" }));
        await flushPromises();

        await byTest(wrapper, "rca-resume-btn").trigger("click");

        expect(wrapper.emitted("resume-rca")).toEqual([["run-src"]]);
      });

      it("no resumable run: no Resume run", async () => {
        wrapper = mountPanel(failedProps());
        await flushPromises();

        expect(byTest(wrapper, "rca-resume-btn").exists()).toBe(false);
      });

      it("a picked earlier run hides Resume run", async () => {
        const viewedRun = rcaRunItem();
        wrapper = mountPanel(
          failedProps({ resumeRunId: "run-2", viewedRun, threadRunId: "run-1" }),
        );
        await flushPromises();

        expect(byTest(wrapper, "rca-resume-btn").exists()).toBe(false);
      });

      it("the resume_run blind spot of the latest run emits resume-rca", async () => {
        answerSummary(
          rcaRunSummaryCancelled({
            state: "failed",
            blind_spots: [rcaBlindSpot({ fix: "resume_run" })],
          }),
        );
        wrapper = mountPanel(failedProps({ resumeRunId: "run-2" }));
        await flushPromises();

        const button = wrapper.find('[data-fix="resume_run"]');
        expect(button.text()).toBe("Resume run");
        await button.trigger("click");
        expect(wrapper.emitted("resume-rca")).toEqual([["run-2"]]);
      });

      it("while resuming, Retry is disabled", async () => {
        wrapper = mountPanel(failedProps({ resumeRunId: "run-2", resuming: true }));
        await flushPromises();

        expect(byTest(wrapper, "rca-retry-btn").attributes("disabled")).toBeDefined();
      });
    });

    describe("J4 Feedback", () => {
      it("a graded finished run shows the question and reads the caller's feedback for that run", async () => {
        answerSummary(rcaRunSummary());
        wrapper = mountPanel(completedProps());
        await flushPromises();

        expect(byTest(wrapper, "rca-feedback").exists()).toBe(true);
        expect(getRcaFeedback).toHaveBeenCalledWith("default", "inc-1", "run-1");
      });

      it("a legacy finished run has no feedback", async () => {
        wrapper = mountPanel(completedProps());
        await flushPromises();

        expect(byTest(wrapper, "rca-feedback").exists()).toBe(false);
        expect(getRcaFeedback).not.toHaveBeenCalled();
      });

      it("a live run has no feedback", async () => {
        answerSummary(rcaRunSummaryLive());
        wrapper = mountPanel(liveProps());
        await flushPromises();

        expect(byTest(wrapper, "rca-feedback").exists()).toBe(false);
      });
    });
  });
});
