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
    steerRca: vi.fn(),
  },
}));
const serverSkew = vi.hoisted(() => ({ ms: 0 }));
vi.mock("@/composables/useAnnouncementBanners", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serverNowMs: () => Date.now() + serverSkew.ms,
}));

import IncidentRCAAnalysis from "./IncidentRCAAnalysis.vue";
import RcaCancelRunDialog from "./rca/RcaCancelRunDialog.vue";
import RcaGuidanceDialog from "./rca/RcaGuidanceDialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import i18n from "@/locales";
import awsConfig from "@/aws-exports";
import type { RcaAskPayload } from "@/utils/incidents/rcaAskAttachment";
import store from "@/test/unit/helpers/store";
import incidentsService from "@/services/incidents";
import { formatTimestamp } from "@/utils/date";
import { rcaThreadPlainText } from "@/utils/incidents/rcaThread";
import type { RcaReadStatus } from "@/composables/useIncidentRca";
import { resetAssistantV2ForTests } from "@/composables/assistant/flags";
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
import type { RcaRunSummary, RcaSteering, RcaThread } from "@/services/incidents";

const steerRca = vi.mocked(incidentsService.steerRca);

/** What the live stream holds for the thread's run; a test sets the parts it needs. */
interface StreamAnswers {
  thread: RcaThread | null;
  threadStatus: RcaReadStatus;
  runSummary: RcaRunSummary | null;
  runSummaryStatus: RcaReadStatus;
  steering: RcaSteering | null;
}
let answers: StreamAnswers;

/** The stream's parts as props; the summary carries the id of the thread's run. */
const streamProps = (props: Record<string, unknown>) => {
  const runId = props.threadRunId as string | null | undefined;
  const { runSummary } = answers;
  return {
    ...answers,
    runSummary: runSummary && runId ? { ...runSummary, run_id: runId } : runSummary,
  };
};

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

function mountPanel(props: Record<string, unknown> = {}, extraStubs: Record<string, unknown> = {}) {
  return mount(IncidentRCAAnalysis, {
    props: { orgId: "default", incidentId: "inc-1", ...streamProps(props), ...props },
    global: { plugins: [i18n, store], stubs: { ...stubs, ...extraStubs } },
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

const setAssistantFlag = (on: boolean | undefined) => {
  window.__O2_ASSISTANT_V2__ = on;
  resetAssistantV2ForTests();
};

/** The latest run failed and the reader picked the completed run-1. */
const pickedProps = () => ({
  rca: rcaSummary({ state: "failed", current_run: rcaRun({ state: "failed" }) }),
  error: { code: "x", reason: "Boom", details: null, trigger_type: null },
  viewedRun: rcaRunItem(),
  reportRun: rcaRunItem(),
  history: [rcaRunItem({ run_id: "run-2", state: "failed" }), rcaRunItem()],
  reportText: REPORT,
  threadRunId: "run-1",
});

describe("IncidentRCAAnalysis", () => {
  let wrapper: VueWrapper;
  // The test setup installs a writable navigator.clipboard with a vi.fn writeText.
  const writeText = vi.mocked(navigator.clipboard.writeText);

  // The incident page's confirm-gated controls ship behind the assistant flag.
  beforeAll(() => setAssistantFlag(true));
  afterAll(() => setAssistantFlag(undefined));

  beforeEach(() => {
    answers = {
      thread: rcaThread(),
      threadStatus: "ready",
      // Runs with no stored record.
      runSummary: rcaRunSummaryLegacy(),
      runSummaryStatus: "ready",
      steering: rcaSteering(),
    };
    writeText.mockReset().mockResolvedValue(undefined);
    steerRca.mockReset().mockResolvedValue({ data: { run_state: "running" } } as never);
    store.state.zoConfig.incidents_rca_enabled = true;
  });

  /** Mounts the panel and waits for its first reads. */
  const showPanel = async (props: Record<string, unknown> = {}, extraStubs = {}) => {
    wrapper = mountPanel(props, extraStubs);
    await flushPromises();
  };
  const RUN_CLOSING = {
    isAxiosError: true,
    response: { status: 409, data: { error_code: "run_closing" } },
  };
  const sendSteer = async (text: string) => {
    await wrapper.find('[data-test="rca-steer-composer"] textarea').setValue(text);
    await wrapper.find('[data-test="rca-steer-composer"]').trigger("submit");
  };

  afterEach(() => {
    wrapper?.unmount();
    toastMock.mockClear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("no new run can start", () => {
    const LOCK = "Locked: needs AI Assistant";
    const failedRun = (overrides: Record<string, unknown> = {}) => ({
      rca: rcaSummary({
        state: "failed",
        current_run: rcaRun({ state: "failed", ended_at: RCA_T0 + sec(180) }),
      }),
      error: { code: "timeout", reason: "Timed out", details: null, trigger_type: null },
      history: [rcaRunItem({ run_id: "run-2", state: "failed" })],
      threadRunId: "run-2",
      resumeRunId: "run-2",
      ...overrides,
    });
    const reasonOf = (id: string) =>
      wrapper
        .findAllComponents(OTooltip)
        .find((tooltip) => tooltip.find(`[data-test="${id}"]`).exists())
        ?.props("content");

    beforeEach(() => {
      store.state.zoConfig.incidents_rca_enabled = false;
      store.state.zoConfig.features = { ai_assistant: "locked" };
      store.state.zoConfig.feature_names = { ai_assistant: "AI Assistant" };
    });

    afterEach(() => {
      delete store.state.zoConfig.features;
      delete store.state.zoConfig.feature_names;
    });

    it("Analyze is disabled with the lock reason and no credit line", async () => {
      wrapper = mountPanel({ rca: null, analyzeCreditCost: 5 });
      const button = byTest(wrapper, "trigger-rca-btn");

      expect(button.attributes("disabled")).toBeDefined();
      expect(button.find(".lock-chip").exists()).toBe(true);
      expect(reasonOf("trigger-rca-btn")).toBe(LOCK);
      expect(byTest(wrapper, "rca-credit-cost").exists()).toBe(false);
      await button.trigger("click");
      expect(wrapper.emitted("trigger-rca")).toBeUndefined();
    });

    it.each(["hidden", "enabled"])("the flag decides, whatever the license key says: %s", (key) => {
      store.state.zoConfig.features = { ai_assistant: key };
      wrapper = mountPanel({ rca: null });

      expect(byTest(wrapper, "trigger-rca-btn").attributes("disabled")).toBeDefined();
      expect(reasonOf("trigger-rca-btn")).toBe("RCA disabled");
    });

    it("a past run stays readable while Re-analyze locks", async () => {
      wrapper = mountPanel(completedProps());
      await flushPromises();
      const button = byTest(wrapper, "rca-thread-reanalyze");

      expect(button.attributes("disabled")).toBeDefined();
      expect(button.find(".lock-chip").exists()).toBe(true);
      expect(reasonOf("rca-thread-reanalyze")).toBe(LOCK);
      await button.trigger("click");
      expect(byTest(wrapper, "rca-guidance-dialog").exists()).toBe(false);
      expect(byTest(wrapper, "rca-existing-container").text()).toContain("Memory leak");
      expect(byTest(wrapper, "rca-copy-btn").exists()).toBe(true);
    });

    it.each([
      ["with no earlier report", {}],
      ["with an earlier report", { reportRun: rcaRunItem(), reportText: REPORT }],
    ])("a failed run %s: Retry locks and Resume goes", async (_name, overrides) => {
      await showPanel(failedRun(overrides));
      const button = byTest(wrapper, "rca-retry-btn");

      expect(button.attributes("disabled")).toBeDefined();
      expect(button.find(".lock-chip").exists()).toBe(true);
      expect(reasonOf("rca-retry-btn")).toBe(LOCK);
      expect(byTest(wrapper, "rca-retry-build").exists()).toBe(false);
      expect(byTest(wrapper, "rca-resume-btn").exists()).toBe(false);
      await button.trigger("click");
      expect(wrapper.emitted("trigger-rca")).toBeUndefined();
    });

    it("the thread says the run is final and a resume_run blind spot has no button", async () => {
      answers.runSummary = rcaRunSummary({
        run_id: "run-2",
        blind_spots: [rcaBlindSpot({ fix: "resume_run" })],
      });
      await showPanel(failedRun());

      expect(byTest(wrapper, "rca-thread-final-note").text()).not.toContain("Resume");
      expect(wrapper.find('[data-fix="resume_run"]').exists()).toBe(false);
    });

    it("a live run keeps Cancel and the steer box", async () => {
      await showPanel(liveProps());

      expect(byTest(wrapper, "rca-cancel-btn").attributes("disabled")).toBeUndefined();
      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(true);
    });

    it("a message the run did not take offers no new run", async () => {
      store.state.zoConfig.incidents_rca_enabled = true;
      await showPanel(liveProps());
      steerRca.mockRejectedValue(RUN_CLOSING);
      await sendSteer("PR #812 at 14:02");
      await flushPromises();
      expect(byTest(wrapper, "rca-thread-refusal-reanalyze").exists()).toBe(true);

      store.state.zoConfig.incidents_rca_enabled = false;
      await flushPromises();

      expect(byTest(wrapper, "rca-thread-refusal-text").text()).toBe("PR #812 at 14:02");
      expect(byTest(wrapper, "rca-thread-refusal-reanalyze").exists()).toBe(false);
    });
  });

  describe("TH40 K: no run", () => {
    it.each(["analysis", "report"])(
      "the %s tab shows the Analyze button only, and emits a fresh trigger",
      async (view) => {
        wrapper = mountPanel({ rca: null, view });

        expect(byTest(wrapper, "rca-trigger-section").exists()).toBe(true);
        for (const id of ["rca-analysis-bar", "rca-verdict-card", "rca-thread-column"])
          expect(byTest(wrapper, id).exists(), id).toBe(false);
        expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);

        await byTest(wrapper, "trigger-rca-btn").trigger("click");

        expect(wrapper.emitted("trigger-rca")).toEqual([[{ buildOnPrevious: false }]]);
      },
    );
  });

  describe("AI credits", () => {
    const refusal = {
      reason: "Your organization has used all of its AI credits.",
      remedy: "plans",
      retry: { buildOnPrevious: false },
    };

    it("K: Analyze shows its cost only when it is known", () => {
      wrapper = mountPanel({ rca: null, analyzeCreditCost: 50 });
      expect(byTest(wrapper, "rca-credit-cost").text()).toBe("Uses 50 AI credits");

      wrapper.unmount();
      wrapper = mountPanel({ rca: null });
      expect(byTest(wrapper, "rca-credit-cost").exists()).toBe(false);
    });

    it("K: a refused first run shows the blocked banner, and Retry resends it", async () => {
      wrapper = mountPanel({ rca: null, refusal });

      expect(byTest(wrapper, "rca-blocked-banner").exists()).toBe(true);
      expect(byTest(wrapper, "rca-plans-btn").exists()).toBe(true);
      await byTest(wrapper, "rca-blocked-retry-btn").trigger("click");

      expect(wrapper.emitted("trigger-rca")).toEqual([[{ buildOnPrevious: false }]]);
    });

    it("a refused re-analysis shows the blocked banner on the card and its cost in the dialog", async () => {
      wrapper = mountPanel({
        ...completedProps(),
        refusal: { ...refusal, remedy: "contact" },
        reanalyzeCreditCost: 5,
      });
      await flushPromises();

      expect(
        byTest(wrapper, "rca-verdict-card").find('[data-test="rca-contact-btn"]').exists(),
      ).toBe(true);
      expect(wrapper.findComponent(RcaGuidanceDialog).props("creditCost")).toBe(5);
    });
  });

  describe("E5 / TH36: one analysis column and the thread column, no view tabs", () => {
    it("has no Summary/Thread/Report tabs; bar, card, report in that order; thread on the right", async () => {
      await showPanel(completedProps());

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

    it.each([
      ["no earlier report", {}],
      ["an earlier report, which it hides", { reportRun: rcaRunItem(), reportText: REPORT }],
    ])("live with %s: the report shows after the run", async (_case, overrides) => {
      await showPanel(liveProps(overrides));

      expect(byTest(wrapper, "rca-report-pending").exists()).toBe(true);
      expect(byTest(wrapper, "rca-existing-container").exists()).toBe(false);
    });

    it("shows the analysis loading line until the summary answers, then the report loading line (legacy)", async () => {
      answers.runSummary = null;
      answers.runSummaryStatus = "loading";
      wrapper = mountPanel({ ...completedProps(), reportText: "", reportLoading: true });

      expect(byTest(wrapper, "rca-summary-loading").text()).toBe("Loading the analysis…");
      expect(byTest(wrapper, "rca-report-loading").exists()).toBe(false);
      await wrapper.setProps({
        runSummary: rcaRunSummaryLegacy({ run_id: "run-1" }),
        runSummaryStatus: "ready",
      });

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
      await showPanel(completedProps());

      expect(byTest(wrapper, "rca-stage-stepper").exists()).toBe(false);
    });
  });

  describe("TH38: the thread column", () => {
    it("shows the thread of the run Live with its trigger", async () => {
      await showPanel(liveProps());

      expect(byTest(wrapper, "rca-thread-live-pill").text()).toBe("Live");
      expect(byTest(wrapper, "rca-thread-start-trigger").text()).toBe("Re-analyze by a.rao");
      expect(wrapper.findAll('[data-test="rca-thread-step"]')).toHaveLength(2);
    });

    it("shows Context used from the current run", async () => {
      await showPanel(
        liveProps({
          rca: rcaSummary({
            current_run: rcaRun({
              context_used: { past_causes: [], skills: ["k8s"], toolsets: [] },
            }),
          }),
        }),
      );

      expect(byTest(wrapper, "rca-thread-context-toggle").text()).toBe("Context used · 1 skill");
    });

    it("a completed run is Saved with the final note", async () => {
      answers.thread = rcaThread({ run_id: "run-1", active: false, steps: [rcaStep()] });
      await showPanel(completedProps());

      expect(byTest(wrapper, "rca-thread-saved-pill").text()).toBe("Saved");
      expect(byTest(wrapper, "rca-thread-final-note").exists()).toBe(true);
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

    it.each([
      [{ mode: "build_on_previous" }, "Building on the previous report…"],
      [
        {
          trigger: "resume",
          context_used: {
            resumed_from: {
              run_id: "run-1",
              steps: 2,
              from_step: { index: 3, stage: "changes", title: "Await flag change actor" },
            },
          },
        },
        "Resuming from “Await flag change actor”…",
      ],
    ])("M: a live re-run after an earlier report says how it continues", async (run, message) => {
      await showPanel(
        liveProps({
          rca: rcaSummary({ current_run: rcaRun(run) }),
          reportRun: rcaRunItem(),
          reportText: REPORT,
        }),
      );

      expect(byTest(wrapper, "rca-reanalyzing-message").text()).toBe(message);
      expect(byTest(wrapper, "rca-banner-cancel-btn").exists()).toBe(false);
      expect(wrapper.emitted("cancel-rca")).toBeUndefined();
    });

    it("M: inside the assistant's thread the banner offers neither Follow in thread nor Cancel", async () => {
      await showPanel(
        liveProps({
          layout: "assistant",
          rca: rcaSummary({ current_run: rcaRun({ mode: "build_on_previous" }) }),
          reportRun: rcaRunItem(),
          reportText: REPORT,
        }),
      );

      expect(byTest(wrapper, "rca-reanalyzing-banner").exists()).toBe(true);
      expect(byTest(wrapper, "rca-follow-thread-btn").exists()).toBe(false);
      expect(byTest(wrapper, "rca-banner-cancel-btn").exists()).toBe(false);
    });

    it("M: Follow in thread scrolls the thread column", async () => {
      const scrollTo = vi.fn();
      Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        value: scrollTo,
        configurable: true,
      });
      await showPanel(liveProps({ reportRun: rcaRunItem(), reportText: REPORT }));

      await byTest(wrapper, "rca-follow-thread-btn").trigger("click");
      await flushPromises();

      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
    });

    it("L: a failed run after an earlier report shows the reason and Retry modes, not that report", async () => {
      await showPanel({
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

      expect(byTest(wrapper, "rca-error-reason").text()).toBe("Agent unavailable");
      expect(byTest(wrapper, "rca-existing-container").exists()).toBe(false);
      await byTest(wrapper, "rca-retry-fresh").trigger("click");
      expect(wrapper.emitted("trigger-rca")).toEqual([[{ buildOnPrevious: false }]]);
    });

    it("N: the stale flag shows the stale warning with Cancel run", async () => {
      await showPanel(liveProps({ rca: rcaSummary({ stale: true }), stale: true }));

      expect(byTest(wrapper, "rca-stale-message").text()).toBe(
        "This analysis has been running unusually long and may have stopped. No new messages since 08:55:20 UTC. Cancel it and try again.",
      );
      await byTest(wrapper, "rca-stale-cancel-btn").trigger("click");
      expect(wrapper.emitted("cancel-rca")).toBeUndefined();
      expect(document.body.textContent).toContain("Cancel run?");
      (document.querySelector('[data-test="rca-cancel-confirm-btn"]') as HTMLElement).click();
      await flushPromises();
      expect(wrapper.emitted("cancel-rca")).toHaveLength(1);
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

    // The second step was cut off mid-call and the last never finished before the run ended.
    const cutThread = () =>
      rcaThread({
        active: false,
        report_submitted: false,
        steps: [
          rcaStep({ index: 1 }),
          rcaStep({
            index: 2,
            tool_calls: [rcaToolCall(), rcaToolCall({ status: "error", interrupted: true })],
          }),
          rcaStep({ index: 3 }),
        ],
      });

    it.each([
      ["a step cut off by the run's end does not count", cutThread, 4, undefined, [1, 4]],
      ["the thread's step count wins when the summary lags", null, 1, undefined, [1, 2]],
      ["with no thread, all but the step open at the cancel", "expired", 5, undefined, [4, 5]],
      ["with no thread, the run's stored Resume count wins", "expired", 5, 2, [2, 5]],
      ["with no thread and no steps", "expired", 0, undefined, [0, 0]],
    ] as const)(
      "names who cancelled, when, after how long and the checks finished: %s",
      async (_case, thread, summarySteps, reusable, [done, total]) => {
        if (thread === "expired") {
          answers.thread = null;
          answers.threadStatus = "expired";
        } else {
          answers.thread = thread ? thread() : rcaThread({ active: false });
        }
        const props = cancelledProps(summarySteps);
        if (reusable !== undefined) props.rca.summary.reusable_steps = reusable;
        await showPanel(props);

        expect(byTest(wrapper, "rca-cancelled-message").text()).toBe(
          cancelledSentence(done, total),
        );
      },
    );
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
          has_record: false,
        }),
        rcaRunItem({ run_id: "run-1", trigger: "auto_new_incident" }),
      ];
      await showPanel({
        ...completedProps(),
        rca: rcaSummary({ run_id: "run-3", state: "completed" }),
        history,
      });

      expect(byTest(wrapper, "rca-history-item-1").attributes("data-disabled")).toBe("true");
      await byTest(wrapper, "rca-history-item-2").trigger("click");
      await byTest(wrapper, "rca-history-item-0").trigger("click");
      expect(wrapper.emitted("view-run")).toEqual([["run-1"], [null]]);
    });

    it("a picked completed run shows as Analyzed while the latest run failed", async () => {
      await showPanel(pickedProps());

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Analyzed");
      expect(byTest(wrapper, "rca-error-banner").exists()).toBe(false);
      expect(byTest(wrapper, "rca-run-selector-label").text()).toBe("Run 1 · Oct 9, 08:53 UTC");
    });

    it("a picked cancelled run with a record shows its own cancel line and partial record", async () => {
      const viewedRun = rcaRunItem({
        run_id: "run-1",
        trigger: "reanalyze",
        started_by: "j.doe@acme.io",
        state: "cancelled",
        cancelled_by: "j.doe@acme.io",
        started_at: RCA_T0,
        ended_at: RCA_T0 + sec(90),
        has_record: true,
      });
      answers.runSummary = rcaRunSummaryCancelled();
      answers.thread = rcaThread({ run_id: "run-1", active: false });
      await showPanel({
        rca: rcaSummary({
          run_id: "run-2",
          state: "completed",
          current_run: rcaRun({ run_id: "run-2", state: "completed" }),
        }),
        reportRun: rcaRunItem({ run_id: "run-2", trigger: "resume" }),
        viewedRun,
        history: [rcaRunItem({ run_id: "run-2", trigger: "resume" }), viewedRun],
        threadRunId: "run-1",
      });

      expect(byTest(wrapper, "rca-cancelled-message").text()).toBe(
        "Cancelled by j.doe at 08:54:50 UTC after 1m30s. 1 of 2 checks finished; the partial results below are not a verdict.",
      );
      expect(byTest(wrapper, "rca-reanalyzing-banner").exists()).toBe(false);
      expect(byTest(wrapper, "rca-resume-btn").exists()).toBe(false);
      expect(byTest(wrapper, "rca-hypotheses").exists()).toBe(true);
      expect(byTest(wrapper, "rca-run-selector-label").text()).toBe("Run 1 · Oct 9, 08:53 UTC");
    });

    it("the subtitle names the trigger and its age on the server clock", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: (RCA_T0 + sec(127)) / 1000 });
      serverSkew.ms = 10_000;
      await showPanel(liveProps());
      serverSkew.ms = 0;

      expect(byTest(wrapper, "rca-analysis-subtitle").text()).toBe(
        "Re-analyze by a.rao · started 17s ago",
      );
    });

    it("Re-analyze opens the dialog, which can build on the completed run", async () => {
      await showPanel(completedProps());
      const dialog = wrapper.findComponent(RcaGuidanceDialog);
      expect(dialog.props("open")).toBe(false);

      await byTest(wrapper, "rca-thread-reanalyze").trigger("click");
      expect(dialog.props("open")).toBe(true);
      expect(dialog.props("canBuildOnPrevious")).toBe(true);
      expect(wrapper.emitted("trigger-rca")).toBeUndefined();
    });

    it("Cancel run emits cancel-rca while live", async () => {
      await showPanel(liveProps());

      await byTest(wrapper, "rca-cancel-btn").trigger("click");
      expect(wrapper.emitted("cancel-rca")).toBeUndefined();
      wrapper.findComponent(RcaCancelRunDialog).vm.$emit("confirm");
      expect(wrapper.emitted("cancel-rca")).toHaveLength(1);
    });

    it("a finished run shows Re-analyze once, in the thread's closed line", async () => {
      wrapper = mountPanel(completedProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-reanalyze-btn").exists()).toBe(false);
      expect(wrapper.findAll('[data-test="rca-thread-reanalyze"]')).toHaveLength(1);
      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(false);
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
    /** A pre-upgrade run: the stream reads nothing for it. */
    const V1_STREAM = {
      threadRunIsV1: true,
      thread: null,
      threadStatus: "idle",
      runSummary: null,
      runSummaryStatus: "idle",
      steering: null,
    } as const;

    it("a v1-only incident shows the Analyzed card and the report", async () => {
      await showPanel({
        rca: rcaV1Summary([V1, OLDER_V1]),
        reportRun: V1,
        history: [V1, OLDER_V1],
        reportText: REPORT,
        threadRunId: "v1-0",
        threadLive: false,
        ...V1_STREAM,
      });

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Analyzed");
      expect(byTest(wrapper, "rca-existing-container").text()).toContain("Memory leak");
      expect(byTest(wrapper, "rca-summary-loading").exists()).toBe(false);
      expect(byTest(wrapper, "rca-thread-empty").text()).toBe(NO_TRANSCRIPT);
      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(false);
      expect(byTest(wrapper, "rca-resume-btn").exists()).toBe(false);
      expect(wrapper.findComponent(RcaGuidanceDialog).props("canBuildOnPrevious")).toBe(true);
    });

    it("the selector opens a v1 report; the picked v1 run shows its report and reads no thread", async () => {
      answers.runSummary = rcaRunSummary();
      await showPanel({ ...completedProps(), history: [rcaRunItem(), V1] });
      expect(byTest(wrapper, "rca-what-happened").exists()).toBe(true);

      expect(byTest(wrapper, "rca-history-item-1").attributes("data-disabled")).toBe("false");
      await byTest(wrapper, "rca-history-item-1").trigger("click");
      expect(wrapper.emitted("view-run")).toEqual([["v1-0"]]);

      await wrapper.setProps({
        viewedRun: V1,
        threadRunId: "v1-0",
        reportText: "## Root Cause\n\nDisk full on the ledger node.",
        ...V1_STREAM,
      });
      await flushPromises();

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Analyzed");
      expect(byTest(wrapper, "rca-what-happened").exists()).toBe(false);
      expect(byTest(wrapper, "rca-existing-container").text()).toContain("Disk full");
      expect(byTest(wrapper, "rca-thread-empty").text()).toBe(NO_TRANSCRIPT);
    });
  });

  describe("⋯ menu (E5)", () => {
    it("Copy report puts the markdown on the clipboard", async () => {
      await showPanel(completedProps());

      await byTest(wrapper, "rca-copy-btn").trigger("click");
      await flushPromises();

      const copied = writeText.mock.calls[0][0];
      expect(copied.startsWith("# inc-1 · incident analysis\nLink: ")).toBe(true);
      expect(copied.endsWith(REPORT)).toBe(true);
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    });

    it("Download as Markdown writes a .md file with the same text, named for its run", async () => {
      const createObjectURL = vi.mocked(URL.createObjectURL);
      createObjectURL.mockClear().mockReturnValueOnce("blob:rca");
      vi.mocked(URL.revokeObjectURL).mockClear();
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      // The shown run-1 is Run 2: run-0 came before it.
      await showPanel({
        ...completedProps(),
        history: [rcaRunItem(), rcaRunItem({ run_id: "run-0" })],
      });

      await byTest(wrapper, "rca-download-btn").trigger("click");

      expect(click).toHaveBeenCalledTimes(1);
      const anchor = click.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.download).toBe("incident-inc-1-rca-run-2.md");
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe("text/markdown;charset=utf-8");
      // jsdom's Blob has no text(); FileReader reads it.
      const reader = new FileReader();
      const read = Promise.withResolvers<void>();
      reader.onload = () => read.resolve();
      reader.readAsText(blob);
      await read.promise;
      // The same text Copy report writes.
      await byTest(wrapper, "rca-copy-btn").trigger("click");
      await flushPromises();
      expect(reader.result).toBe(writeText.mock.calls[0][0]);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:rca");
    });

    it("Copy thread puts the plain-text transcript on the clipboard", async () => {
      await showPanel(liveProps());

      await byTest(wrapper, "rca-copy-thread-btn").trigger("click");
      await flushPromises();

      expect(writeText).toHaveBeenCalledWith(
        rcaThreadPlainText(rcaThread(), "Investigation thread"),
      );
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "success", message: "Thread copied to clipboard" }),
      );
    });

    it("a clipboard failure shows the failure toast", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      writeText.mockRejectedValue(new Error("denied"));
      await showPanel(liveProps());

      await byTest(wrapper, "rca-copy-thread-btn").trigger("click");
      await flushPromises();

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error", message: "Failed to copy thread" }),
      );
    });

    it("Copy thread is disabled when the run has no transcript", async () => {
      answers.thread = rcaThread({ transcript: "none", steps: [], started: null });
      await showPanel(completedProps());

      expect(byTest(wrapper, "rca-copy-thread-btn").attributes("data-disabled")).toBe("true");
      expect(byTest(wrapper, "rca-thread-empty").text()).toBe("This run has no stored transcript.");
    });
  });

  describe("review fixes", () => {
    it("Build on previous is enabled by a completed run even while its report text loads", async () => {
      await showPanel({ ...completedProps(), reportText: "", reportLoading: true });

      expect(wrapper.findComponent(RcaGuidanceDialog).props("canBuildOnPrevious")).toBe(true);
      // Copy/Download still need the text.
      expect(byTest(wrapper, "rca-copy-btn").attributes("data-disabled")).toBe("true");
    });

    it("Build on previous is disabled without a completed run", async () => {
      await showPanel({
        rca: rcaSummary({ state: "failed", current_run: rcaRun({ state: "failed" }) }),
        error: { code: "x", reason: "Boom", details: null, trigger_type: null },
        threadRunId: "run-2",
      });

      expect(wrapper.findComponent(RcaGuidanceDialog).props("canBuildOnPrevious")).toBe(false);
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
        () => {
          answers.thread = rcaThread({
            run_id: "run-1",
            transcript: "none",
            steps: [],
            started: null,
          });
        },
      ],
      ["expired", () => ((answers.thread = null), (answers.threadStatus = "expired"))],
      ["incomplete", () => ((answers.thread = null), (answers.threadStatus = "incomplete"))],
      ["unavailable", () => ((answers.thread = null), (answers.threadStatus = "unavailable"))],
    ])("m5: the stats line falls back to the run's stats for %s", async (_case, arrange) => {
      arrange();
      await showPanel(statsProps());

      expect(byTest(wrapper, "rca-thread-stats").text()).toBe("5 checks · 11 tool calls · 1m47s");
    });

    it("Retry: a saved run whose thread could not be read asks for the live stream again", async () => {
      answers.thread = null;
      answers.threadStatus = "unavailable";
      await showPanel(completedProps());
      expect(byTest(wrapper, "rca-thread-empty").text()).toContain(
        "The thread could not be loaded.",
      );

      await byTest(wrapper, "rca-thread-retry-btn").trigger("click");
      expect(wrapper.emitted("retry-live")).toEqual([[]]);

      await wrapper.setProps({
        thread: rcaThread({ run_id: "run-1", active: false }),
        threadStatus: "ready",
      });
      expect(byTest(wrapper, "rca-thread-retry-btn").exists()).toBe(false);
      expect(wrapper.findAll('[data-test="rca-thread-step"]')).toHaveLength(2);
    });
  });

  describe("Report tab", () => {
    const showReport = (props: Record<string, unknown>) => showPanel({ ...props, view: "report" });

    it("shows the run selector, Copy report and Download as Markdown as buttons, then the report", async () => {
      answers.runSummary = rcaRunSummary();
      await showReport(completedProps());

      expect(byTest(wrapper, "rca-run-selector").exists()).toBe(true);
      expect(byTest(wrapper, "rca-reanalyze-btn").exists()).toBe(false);
      expect(byTest(wrapper, "rca-more-btn").exists()).toBe(false);
      expect(byTest(wrapper, "rca-thread-column").exists()).toBe(false);
      expect(byTest(wrapper, "rca-verdict-card").exists()).toBe(false);
      const content = byTest(wrapper, "rca-report-tab-content");
      expect(content.text()).toContain("Memory leak");

      await byTest(wrapper, "rca-report-copy-btn").trigger("click");
      await flushPromises();
      expect(writeText.mock.calls[0][0]).toContain(REPORT);
      await byTest(wrapper, "rca-history-item-0").trigger("click");
      expect(wrapper.emitted("view-run")).toEqual([[null]]);
    });

    it("discards a copy preview when the selected run changes before copying finishes", async () => {
      let finishCopy!: () => void;
      writeText.mockImplementationOnce(
        () => new Promise<void>((resolve) => (finishCopy = resolve)),
      );
      await showReport(completedProps());
      await byTest(wrapper, "rca-report-copy-btn").trigger("click");
      await wrapper.setProps({ viewedRun: rcaRunItem({ run_id: "run-0" }) });
      finishCopy();
      await flushPromises();
      expect(wrapper.findComponent({ name: "RcaAnalysisBar" }).props("copyPreview")).toBeNull();
    });

    it("when the report fails to load, says so in red with Retry, not that the run had none", async () => {
      await showReport({ ...completedProps(), reportText: "", reportFailed: true });

      const failed = byTest(wrapper, "rca-report-load-failed");
      expect(failed.attributes("role")).toBe("alert");
      expect(failed.text()).toContain("Couldn't load the report");
      expect(byTest(wrapper, "rca-report-none-panel").exists()).toBe(false);
      expect(byTest(wrapper, "rca-report-tab-loading").exists()).toBe(false);

      await failed.get('[data-test="rca-report-retry-btn"]').trigger("click");
      expect(wrapper.emitted("retry-report")).toHaveLength(1);
      await wrapper.setProps({ reportFailed: false, reportLoading: true });
      expect(byTest(wrapper, "rca-report-load-failed").exists()).toBe(false);
      expect(byTest(wrapper, "rca-report-tab-loading").exists()).toBe(true);
      expect(byTest(wrapper, "rca-report-none-panel").exists()).toBe(false);
    });

    it("while the run is live, says the report shows after the run and follows the thread", async () => {
      answers.runSummary = rcaRunSummaryLive();
      await showReport(liveProps());

      const pending = byTest(wrapper, "rca-report-pending-panel");
      expect(pending.text()).toContain("The report shows after the run.");
      expect(byTest(wrapper, "rca-report-copy-btn").exists()).toBe(false);
      await pending.get('[data-test="rca-report-follow-thread"]').trigger("click");
      expect(wrapper.emitted("open-analysis")).toHaveLength(1);
    });
  });

  describe("lighter analysis, report index and failed analyses", () => {
    const VERDICT = {
      impactedServices: [],
      proposedActions: [
        { title: "Restrict admin ports", kind: "other" as const, detail: "Narrow the groups." },
        { title: "Check admin logins", kind: "other" as const, detail: "Correlate." },
      ],
      pageRecommendation: { action: "page" as const, reason: "Exposure needs review." },
    };
    const AGENT_REPORT = [
      "# Incident Analysis Report",
      "## Subject Summary",
      "Rejected flows [e1], cited [e9].",
      "## Executive Summary",
      "Benign scanning.",
    ].join("\n");
    const FAILED_EVENTS = [
      { timestamp: RCA_T0, type: "ai_analysis_begin" },
      {
        timestamp: RCA_T0 + sec(120),
        type: "ai_analysis_failed",
        data: { reason: "RCA service call failed" },
      },
      { timestamp: RCA_T0 + sec(600), type: "ai_analysis_begin" },
      {
        timestamp: RCA_T0 + sec(720),
        type: "ai_analysis_failed",
        data: { reason: "Service call failed" },
      },
    ];

    afterEach(() => {
      store.state.timezone = "UTC";
    });

    it("the facts read this incident's firings and the alerts' live state", async () => {
      answers.runSummary = rcaRunSummary();
      await showPanel({
        ...completedProps(),
        firings: [
          { alert_id: "a", alert_name: "A", alert_fired_at: RCA_T0 },
          { alert_id: "b", alert_name: "B", alert_fired_at: RCA_T0 + sec(1_200) },
        ],
        alertsNow: { firing: 1, quiet: 1, unknown: 0, total: 2, lastFiring: RCA_T0 + sec(1_200) },
      });

      const value = (id: string) => byTest(wrapper, id).get('[data-test="rca-fact-value"]').text();
      expect(value("rca-fact-incident")).toBe("2 firings · 2 alerts");
      expect(value("rca-fact-now")).toBe("1 of 2 alerts firing now");
    });

    it("the open-finding chip opens that hypothesis", async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const base = rcaRunSummary();
      answers.runSummary = rcaRunSummary({
        hypotheses: [
          ...base.hypotheses,
          { ...base.hypotheses[0], id: "h9", statement: "Admin ports exposed", status: "likely" },
        ],
      });
      await showPanel(completedProps());

      await byTest(wrapper, "rca-verdict-open-finding").trigger("click");
      await flushPromises();
      expect(
        wrapper
          .get('[data-hypothesis-id="h9"] [data-test="rca-fold-row-toggle"]')
          .element.closest("button")
          ?.getAttribute("aria-expanded"),
      ).toBe("true");
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    });

    it("run picker, What happened and the thread read the app's time zone", async () => {
      store.state.timezone = "Asia/Kolkata";
      answers.runSummary = rcaRunSummary();
      await showPanel(completedProps());

      expect(byTest(wrapper, "rca-run-selector-label").text()).toMatch(/GMT\+5:30$/);
      expect(byTest(wrapper, "rca-timeline-day").text()).toContain("GMT+5:30");
      expect(byTest(wrapper, "rca-thread-zone").text()).toBe("times in GMT+5:30");
      const stepTimes = byTest(wrapper, "rca-thread-column")
        .text()
        .match(/14:2\d:\d\d/g);
      expect(stepTimes?.length).toBeGreaterThan(1);
    });

    it.each([
      ["analysis", "rca-failed-retry", "rca-failed-open-analysis", "trigger-rca"],
      ["report", "rca-failed-open-analysis", "rca-failed-retry", "open-analysis"],
    ])(
      "every attempt failed and none succeeded: the %s tab shows the notice, not 'No analysis yet'",
      async (view, shown, hidden, event) => {
        await showPanel({ rca: null, incidentEvents: FAILED_EVENTS, view });

        const notice = byTest(wrapper, "rca-failed-notice");
        expect(notice.get('[data-test="rca-failed-title"]').text()).toContain("2");
        expect(byTest(wrapper, "rca-trigger-section").exists()).toBe(false);
        expect(byTest(notice, hidden).exists()).toBe(false);
        await byTest(notice, shown).trigger("click");
        expect(wrapper.emitted(event)).toHaveLength(1);
      },
    );

    it("a refused retry after failed analyses shows its reason and remedy", async () => {
      await showPanel({
        rca: rcaSummary({ state: "failed", current_run: rcaRun({ state: "failed" }) }),
        incidentEvents: FAILED_EVENTS,
      });
      expect(byTest(wrapper, "rca-failed-notice").exists()).toBe(true);
      await wrapper.setProps({
        refusal: {
          reason: "No AI credits remain.",
          remedy: "plans",
          retry: { buildOnPrevious: false },
        },
      });
      expect(byTest(wrapper, "rca-blocked-reason").text()).toBe("No AI credits remain.");
      expect(byTest(wrapper, "rca-plans-btn").exists()).toBe(true);
      await byTest(wrapper, "rca-blocked-retry-btn").trigger("click");
      expect(wrapper.emitted("trigger-rca")).toEqual([[{ buildOnPrevious: false }]]);
    });

    it("the Report tab puts the Executive Summary first, indexes the sections and renumbers citations", async () => {
      answers.runSummary = rcaRunSummary();
      await showPanel({ ...completedProps(), reportText: AGENT_REPORT, view: "report" });

      expect(
        wrapper.findAll('[data-test="rca-report-index-item"]').map((item) => item.text()),
      ).toEqual(["Executive Summary", "Subject Summary"]);
      const content = byTest(wrapper, "rca-report-tab-content").text();
      expect(content.indexOf("Benign scanning.")).toBeLessThan(content.indexOf("Rejected flows"));
      expect(content).toContain("Rejected flows [1], cited [not verified].");
    });

    it("Copy report puts the verdict lines first, cites a numbered evidence list and previews it", async () => {
      const base = rcaRunSummary();
      answers.runSummary = rcaRunSummary({
        hypotheses: [
          ...base.hypotheses,
          { ...base.hypotheses[0], id: "h9", statement: "Admin ports exposed", status: "likely" },
        ],
      });
      await showPanel(
        {
          ...completedProps(),
          reportText: AGENT_REPORT,
          reportVerdict: VERDICT,
          incidentTitle: "VPC rejected flows",
          view: "report",
        },
        { OPopover: { props: ["open"], template: "<div><slot v-if='open' /></div>" } },
      );

      await byTest(wrapper, "rca-report-copy-btn").trigger("click");
      await flushPromises();
      const text = writeText.mock.calls[0][0];
      const lines = text.split("\n");
      expect(lines[0]).toContain("VPC rejected flows");
      expect(lines[1]).toMatch(/http\S+$/);
      expect(lines[2]).toMatch(/Run 1.*Root cause identified.*High confidence/);
      expect(lines[3]).toContain("Page");
      expect(lines[4]).toBe("Open finding (Likely): Admin ports exposed");
      expect(lines[5]).toContain("Feature-flag history");
      expect(lines[6]).toBe("Times in UTC");
      expect(text.indexOf("## Executive Summary")).toBeLessThan(text.indexOf("## Subject Summary"));
      expect(text).toContain("Rejected flows [1], cited [not verified].");
      expect(text).toMatch(/\n## Evidence\n\n1\. \S/);
      expect(text).not.toContain("# Incident Analysis Report");
      expect(byTest(wrapper, "rca-copy-preview-text").text()).toBe(text);
    });

    it("Open thread goes to Incident Analysis and focuses its thread", async () => {
      answers.runSummary = rcaRunSummary();
      await showPanel({ ...completedProps(), view: "report" });

      await byTest(wrapper, "rca-report-open-thread-btn").trigger("click");
      expect(wrapper.emitted("open-analysis")).toHaveLength(1);
      await wrapper.setProps({ view: "analysis" });
      await flushPromises();
      expect(document.activeElement).toBe(byTest(wrapper, "rca-thread-column").element);
    });
  });

  describe("Phase 3: summary sections (F1, VE36, VE42)", () => {
    const SECTIONS = [
      "rca-what-happened",
      "rca-hypotheses",
      "rca-evidence-list",
      "rca-blind-spots",
    ] as const;

    const shownSections = (w: VueWrapper) => SECTIONS.filter((id) => byTest(w, id).exists());
    const VERDICT_DETAILS = {
      impactedServices: ["service=checkout-api"],
      proposedActions: [{ title: "Roll back 4f2c1e", kind: "rollback", detail: "" }],
      pageRecommendation: { action: "page" as const, reason: "Exposure needs review." },
    };

    it("a graded run shows its verdict, actions and sections, then one line to the Report tab", async () => {
      answers.runSummary = rcaRunSummary();
      await showPanel({ ...completedProps(), reportVerdict: VERDICT_DETAILS });

      const order = [
        "rca-analysis-bar",
        "rca-verdict-card",
        "rca-proposed-actions",
        ...SECTIONS,
        "rca-full-report",
        "rca-thread-column",
      ].map((id) => byTest(wrapper, id).element);
      for (let i = 1; i < order.length; i++) expect(precedes(order[i - 1], order[i])).toBe(true);
      expect(byTest(wrapper, "rca-existing-container").exists()).toBe(false);
      expect(byTest(wrapper, "rca-full-report-content").exists()).toBe(false);
      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Root cause identified");
      expect(byTest(wrapper, "rca-verdict-band").text()).toContain("High");
      expect(byTest(wrapper, "rca-verdict-page").text()).toContain("Page");
      expect(byTest(wrapper, "rca-fact-impact").get('[data-test="rca-fact-value"]').text()).toBe(
        "service=checkout-api",
      );
      expect(byTest(wrapper, "rca-proposed-action").text()).toContain("Roll back 4f2c1e");
      // Copy report stays in the ⋯ menu.
      expect(byTest(wrapper, "rca-copy-btn").attributes("data-disabled")).toBe("false");

      await byTest(wrapper, "rca-open-report-tab").trigger("click");
      expect(wrapper.emitted("open-report")).toHaveLength(1);
    });

    it("a live run with a record shows no Full report of the earlier run", async () => {
      answers.runSummary = rcaRunSummaryLive();
      await showPanel(liveProps({ reportRun: rcaRunItem(), reportText: REPORT }));

      expect(byTest(wrapper, "rca-hypotheses").exists()).toBe(true);
      expect(byTest(wrapper, "rca-full-report").exists()).toBe(false);
    });

    it("a live run never shows the earlier run's services or actions", async () => {
      answers.runSummary = rcaRunSummaryLive();
      await showPanel(
        liveProps({ reportRun: rcaRunItem(), reportText: REPORT, reportVerdict: VERDICT_DETAILS }),
      );

      expect(byTest(wrapper, "rca-verdict-services").exists()).toBe(false);
      expect(byTest(wrapper, "rca-proposed-actions").exists()).toBe(false);
    });

    it.each([
      ["legacy (VE42)", "ready"],
      ["a finished run whose summary cannot be read (F1)", "unavailable"],
    ] as const)(
      "%s: the Analyzed card and the markdown report, no sections",
      async (_c, status) => {
        if (status !== "ready") answers.runSummary = null;
        answers.runSummaryStatus = status;
        await showPanel(completedProps());

        expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Analyzed");
        expect(byTest(wrapper, "rca-verdict-band").exists()).toBe(false);
        expect(byTest(wrapper, "rca-existing-container").text()).toContain("Memory leak");
        expect(shownSections(wrapper)).toEqual([]);
      },
    );

    it("completed with a record but no outcome: Analyzed with no band, the sections, no markdown", async () => {
      const base = rcaRunSummary();
      answers.runSummary = rcaRunSummary({
        card: { ...base.card, outcome: undefined, outcome_reason: undefined },
      });
      await showPanel(completedProps());

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Analyzed");
      expect(byTest(wrapper, "rca-verdict-band").exists()).toBe(false);
      expect(shownSections(wrapper)).toEqual([...SECTIONS]);
      expect(byTest(wrapper, "rca-existing-container").exists()).toBe(false);
    });

    it("live: Leading card with no band; the timeline comes with the report; the tested hypothesis leads", async () => {
      answers.runSummary = rcaRunSummaryLive();
      await showPanel(liveProps());

      expect(byTest(wrapper, "rca-verdict-headline").text()).toBe(
        "Leading: Deploy 4f2c1e exhausted the orders-db pool",
      );
      expect(byTest(wrapper, "rca-verdict-qualifier").text()).toContain("Revised · was “");
      expect(byTest(wrapper, "rca-verdict-band").exists()).toBe(false);
      expect(byTest(wrapper, "rca-verdict-facts").exists()).toBe(false);
      expect(byTest(wrapper, "rca-timeline-pending").text()).toBe(
        "The causal timeline comes with the report.",
      );
      expect(byTest(wrapper, "rca-hypothesis-status").text()).toBe("Testing");
      expect(byTest(wrapper, "rca-report-pending").exists()).toBe(false);
    });

    it("waiting_input: the pill reads 'Blocked · waiting for an answer'", async () => {
      answers.runSummary = rcaRunSummaryLive({ state: "waiting_input" });
      await showPanel(liveProps({ rca: rcaSummary({ state: "waiting_input" }) }));

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Blocked · waiting for an answer");
    });

    it("D blocked: 'Needs: Change history' and the blind spot's button", async () => {
      answers.runSummary = rcaRunSummaryBlocked();
      await showPanel(completedProps());

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Blocked");
      expect(byTest(wrapper, "rca-verdict-below").text()).toBe("Needs: Change history");
      expect(byTest(wrapper, "rca-blind-spot-action").text()).toBe("Connect AI Toolset");
    });

    it("E cancelled with a partial record: no timeline, hypotheses, the run_end blind spot with no button", async () => {
      answers.runSummary = rcaRunSummaryCancelled();
      answers.thread = rcaThread({ active: false });
      await showPanel({
        rca: rcaSummary({
          state: "cancelled",
          current_run: rcaRun({ state: "cancelled", ended_at: RCA_T0 + sec(180) }),
        }),
        threadRunId: "run-2",
      });

      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Cancelled");
      expect(byTest(wrapper, "rca-verdict-headline").text()).toBe(
        "Run cancelled before a verdict. Partial results below",
      );
      expect(byTest(wrapper, "rca-verdict-band").text()).toBe("No confidence");
      expect(shownSections(wrapper)).toEqual([
        "rca-hypotheses",
        "rca-evidence-list",
        "rca-blind-spots",
      ]);
      expect(byTest(wrapper, "rca-blind-spot").text()).toContain("3 stages did not run");
      expect(byTest(wrapper, "rca-blind-spot-action").exists()).toBe(false);
    });

    it("an evidence entry's hypothesis link scrolls to that hypothesis and focuses it", async () => {
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      answers.runSummary = rcaRunSummary();
      await showPanel(completedProps());

      await byTest(byTest(wrapper, "rca-evidence-list"), "rca-fold-row-toggle").trigger("click");
      await byTest(wrapper, "rca-evidence-citation-hypothesis").trigger("click");
      await flushPromises();

      const target = wrapper.find('[data-test="rca-hypothesis"][data-hypothesis-id="h1"]');
      expect(document.activeElement).toBe(target.element);
      expect(scrollIntoView.mock.contexts).toContain(target.element);
    });

    it("the unverified count opens 'Cited but not verified'", async () => {
      Element.prototype.scrollIntoView = vi.fn();
      answers.runSummary = rcaRunSummary();
      await showPanel(completedProps());

      await byTest(wrapper, "rca-verdict-unverified-count").trigger("click");
      await flushPromises();

      expect(document.activeElement).toBe(byTest(wrapper, "rca-unverified").element);
    });

    it("an expired summary of a live run leaves the card in its Phase 2 form", async () => {
      answers.runSummary = null;
      answers.runSummaryStatus = "expired";
      await showPanel(liveProps());

      expect(byTest(wrapper, "rca-verdict-headline").text()).toBe("Investigating");
      expect(shownSections(wrapper)).toEqual([]);
    });

    it("the run ends and its final summary cannot be read: the live view goes and the markdown report shows (F1)", async () => {
      answers.runSummary = rcaRunSummaryLive();
      await showPanel(liveProps());
      expect(byTest(wrapper, "rca-verdict-headline").text()).toContain("Leading: ");

      await wrapper.setProps({
        rca: rcaSummary({ state: "completed", current_run: rcaRun({ state: "completed" }) }),
        reportRun: rcaRunItem({ run_id: "run-2" }),
        reportText: REPORT,
        threadLive: false,
        runSummary: null,
        runSummaryStatus: "unavailable",
      });
      await flushPromises();

      expect(shownSections(wrapper)).toEqual([]);
      expect(byTest(wrapper, "rca-verdict-state").text()).toBe("Analyzed");
      expect(byTest(wrapper, "rca-verdict-headline").text()).not.toContain("Leading");
      expect(byTest(wrapper, "rca-existing-container").text()).toContain("Memory leak");
    });

    it("a thread chip shows its entry number and opens the first entry that cites the id", async () => {
      Element.prototype.scrollIntoView = vi.fn();
      answers.runSummary = rcaRunSummary({
        evidence: [
          rcaEvidenceEntry({ number: 1, ids: ["e3"] }),
          rcaEvidenceEntry({ number: 2, ids: ["e3", "e7"], call_id: "call-9" }),
        ],
      });
      answers.thread = rcaThread({ run_id: "run-1", active: false, steps: [rcaStep()] });
      await showPanel(completedProps());

      await byTest(wrapper, "rca-thread-step-note-toggle").trigger("click");
      const chips = byTest(wrapper, "rca-thread-step").findAll('[data-test="rca-citation-chip"]');
      expect(chips.map((chip) => chip.text())).toEqual(["1", "2"]);

      await chips[0].trigger("click");
      await flushPromises();

      const list = byTest(wrapper, "rca-evidence-list");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
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
    const showSteerable = (props: Record<string, unknown>) =>
      showPanel(props, { ODialog: ODialogStub });
    const pausedProps = () =>
      liveProps({
        rca: rcaSummary({
          state: "waiting_input",
          summary: { stage: "log_patterns", stage_index: 5, steps: 9, tool_calls: 27 },
          current_run: rcaRun({ state: "waiting_input" }),
        }),
      });

    it("B-approvals-rca-P2-4: in the assistant the live composer sits in the sticky dock at the bottom of the panel's scroller", async () => {
      await showSteerable(liveProps({ layout: "assistant" }));

      const dock = byTest(wrapper, "rca-steer-dock");
      expect(dock.classes()).toEqual(expect.arrayContaining(["sticky", "bottom-0"]));
      expect(dock.element.parentElement).toBe(byTest(wrapper, "rca-analysis-container").element);
      expect(dock.find('[data-test="rca-steer-composer"]').exists()).toBe(true);
      expect(
        byTest(wrapper, "rca-thread-column").find('[data-test="rca-steer-composer"]').exists(),
      ).toBe(false);
    });

    it("B-approvals-rca-P2-4: the incident page keeps the composer in its own column, with no dock", async () => {
      await showSteerable(liveProps({ layout: "page" }));

      expect(byTest(wrapper, "rca-steer-dock").exists()).toBe(false);
      expect(
        byTest(wrapper, "rca-thread-column").find('[data-test="rca-steer-composer"]').exists(),
      ).toBe(true);
    });

    it.each([
      ["can_steer on the thread's run shows the composer", undefined, true],
      ["a reader with no steering view sees the thread and no composer", null, false],
      ["can_steer false hides the composer on a live run", { can_steer: false }, false],
    ] as const)("%s", async (_case, steering, shown) => {
      if (steering !== undefined) answers.steering = steering && rcaSteering(steering);
      await showSteerable(liveProps());

      expect(wrapper.findAll('[data-test="rca-thread-step"]')).toHaveLength(2);
      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(shown);
      expect(byTest(wrapper, "rca-thread-final-note").exists()).toBe(false);
    });

    it("send: POSTs the message and reads nothing (05 LU18)", async () => {
      await showSteerable(liveProps());

      await sendSteer("Check the pool");
      await flushPromises();

      expect(steerRca).toHaveBeenCalledWith("default", "inc-1", "run-2", {
        text: "Check the pool",
        kind: "message",
      });
      for (const [name, call] of Object.entries(incidentsService)) {
        if (name !== "steerRca") expect(call, name).not.toHaveBeenCalled();
      }
      expect(wrapper.emitted("steered")).toBeUndefined();
    });

    it("SG40: a run_closing 409 keeps the text visible after the stream hides the composer", async () => {
      await showSteerable(pausedProps());
      steerRca.mockRejectedValue(RUN_CLOSING);

      await sendSteer("PR #812 at 14:02");
      await flushPromises();
      // The stream's next steering view closes the box.
      await wrapper.setProps({ steering: rcaSteering({ can_steer: false }) });

      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(false);
      expect(byTest(wrapper, "rca-thread-refusal-text").text()).toBe("PR #812 at 14:02");
      await byTest(wrapper, "rca-thread-refusal-reanalyze").trigger("click");
      expect(
        (wrapper.find('[data-test="rca-guidance-dialog"] textarea').element as HTMLTextAreaElement)
          .value,
      ).toBe("PR #812 at 14:02");
    });

    it("SG40 race: the stream hides the composer before the refused send settles; the text stays", async () => {
      await showSteerable(pausedProps());
      let refuse!: () => void;
      steerRca.mockReturnValue(
        new Promise((_resolve, reject) => {
          refuse = () => reject(RUN_CLOSING);
        }) as never,
      );

      await sendSteer("PR #812 at 14:02");
      // The stream's steering view closes the box first.
      await wrapper.setProps({ steering: rcaSteering({ can_steer: false }) });
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
      answers.steering = rcaSteering({
        items: [
          rcaSteerRecord({
            text: "Check PR #812",
            status: "rejected",
            status_reason: "finalizing",
          }),
        ],
      });
      await showSteerable(liveProps());
      expect(byTest(wrapper, "rca-guidance-dialog").exists()).toBe(false);

      await byTest(wrapper, "rca-thread-steer-reanalyze").trigger("click");

      const dialog = byTest(wrapper, "rca-guidance-dialog");
      expect((dialog.find("textarea").element as HTMLTextAreaElement).value).toBe("Check PR #812");
      expect(dialog.text()).toContain("Creates a new report version. This one stays as is.");
      const guidance = wrapper
        .findAllComponents(ODialogStub)
        .find((stub) => stub.attributes("data-test") === "rca-guidance-dialog");
      await guidance?.vm.$emit("click:primary");
      expect(wrapper.emitted("trigger-rca")).toEqual([
        [{ buildOnPrevious: false, guidance: "Check PR #812" }],
      ]);
    });

    it("frame I: Re-analyze opens the dialog empty", async () => {
      await showSteerable(completedProps());

      await byTest(wrapper, "rca-thread-reanalyze").trigger("click");

      const dialog = byTest(wrapper, "rca-guidance-dialog");
      expect((dialog.find("textarea").element as HTMLTextAreaElement).value).toBe("");
    });

    it("SG39 frame D: paused banner with the step and the local deadline; 'Waiting for an answer'", async () => {
      answers.thread = rcaThread({ questions: [rcaThreadQuestion()] });
      answers.steering = rcaSteeringPaused();
      await showSteerable(pausedProps());

      expect(byTest(wrapper, "rca-paused-title").text()).toBe(
        "Paused after “Map the checkout dependencies”",
      );
      // RCA_T0 + 30 min in the store's UTC zone.
      expect(byTest(wrapper, "rca-paused-deadline").text()).toBe(
        "The agent waits until 09:23 UTC for an answer, then closes the run as Blocked.",
      );
      expect(byTest(wrapper, "rca-thread-question-status").text()).toBe("Waiting for an answer");
      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(true);
    });

    it.each([
      ["UTC", "08:58 UTC"],
      ["Asia/Kolkata", "14:28 GMT+5:30"],
    ])("SG39 frame G: 'Unblocked by' reads the viewer's zone (%s)", async (zone, readAt) => {
      const before = store.state.timezone;
      store.state.timezone = zone;
      try {
        answers.thread = rcaThread({
          run_id: "run-1",
          active: false,
          steps: [rcaStep()],
          questions: [rcaThreadQuestion()],
        });
        answers.steering = rcaSteeringUnblocked();
        answers.runSummary = rcaRunSummary();
        await showSteerable(completedProps());

        expect(byTest(wrapper, "rca-verdict-unblocked").text()).toBe(
          `Unblocked by a.rao at ${readAt} · change history from a human lead`,
        );
        expect(byTest(wrapper, "rca-thread-question-status").text()).toBe("Answered by a.rao");
      } finally {
        store.state.timezone = before;
      }
    });

    it("H16: a hypothesis action POSTs its body; the row shows 'Pending · <author>' until read", async () => {
      answers.runSummary = rcaRunSummaryLive();
      await showSteerable(liveProps());

      await wrapper.find('[data-test="rca-hypothesis-action-disprove"]').trigger("click");
      await flushPromises();

      expect(steerRca).toHaveBeenCalledWith("default", "inc-1", "run-2", {
        text: "",
        kind: "hypothesis_action",
        action: "disprove",
        hypothesis_id: "h1",
      });
      // The sent row arrives on the stream.
      await wrapper.setProps({
        steering: rcaSteering({
          items: [
            rcaSteerRecord({
              kind: "hypothesis_action",
              action: "disprove",
              hypothesis_id: "h1",
              text: "Disprove h1",
            }),
          ],
        }),
      });
      expect(byTest(wrapper, "rca-hypothesis-pending").text()).toBe("Pending · a.rao");
    });
  });

  describe("Phase 5: Ask, Resume", () => {
    const original = {
      isEnterprise: awsConfig.isEnterprise,
      isCloud: awsConfig.isCloud,
      ai: store.state.zoConfig.ai_enabled,
    };

    beforeEach(() => {
      awsConfig.isEnterprise = "true";
      awsConfig.isCloud = "false";
      store.state.zoConfig.ai_enabled = true;
    });

    afterEach(() => {
      awsConfig.isEnterprise = original.isEnterprise;
      awsConfig.isCloud = original.isCloud;
      store.state.zoConfig.ai_enabled = original.ai;
    });

    const askPayloads = (w: VueWrapper) => w.emitted<[RcaAskPayload]>("ask-ai") ?? [];

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

    describe("J5 Ask", () => {
      it("a finished run with a report: Ask emits the hand-off payload for a new, unsent chat", async () => {
        await showPanel({ ...completedProps(), incidentTitle: "checkout 5xx" });

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
        answers.runSummary = rcaRunSummary();
        await showPanel(completedProps());

        await byTest(wrapper, "rca-ask-btn").trigger("click");

        const [[payload]] = askPayloads(wrapper);
        expect(payload.query).toContain("## Verdict");
        expect(payload.query).toContain("## Evidence");
        expect(payload.query).toContain("## Report");
      });

      it("a live run with no earlier report offers no Ask", async () => {
        await showPanel(liveProps());

        expect(byTest(wrapper, "rca-ask-btn").exists()).toBe(false);
      });

      it.each([
        ["AI disabled on the server", () => (store.state.zoConfig.ai_enabled = false)],
        ["an edition without the AI assistant", () => (awsConfig.isEnterprise = "false")],
      ])("%s: no Ask", async (_label, disable) => {
        disable();
        await showPanel(completedProps());

        expect(byTest(wrapper, "rca-ask-btn").exists()).toBe(false);
      });

      it("a picked earlier run: Ask is about that run", async () => {
        await showPanel(pickedProps());

        await byTest(wrapper, "rca-ask-btn").trigger("click");

        const [[payload]] = askPayloads(wrapper);
        expect(payload.chipName).toBe("Analysis · Run 1 · Oct 9, 08:53 UTC");
        expect(payload.query).toContain("Run: run-1");
        expect(payload.query).not.toContain("run-2");
      });
    });

    describe("J9 Resume", () => {
      it("Resume run on the L banner emits resume-rca with the resumable run id", async () => {
        await showPanel(failedProps({ resumeRunId: "run-src" }));

        await byTest(wrapper, "rca-resume-btn").trigger("click");

        expect(wrapper.emitted("resume-rca")).toEqual([["run-src"]]);
      });

      it.each([
        ["no resumable run", {}],
        [
          "a picked earlier run",
          { resumeRunId: "run-2", viewedRun: rcaRunItem(), threadRunId: "run-1" },
        ],
      ])("%s: no Resume run", async (_case, overrides) => {
        await showPanel(failedProps(overrides));

        expect(byTest(wrapper, "rca-resume-btn").exists()).toBe(false);
      });

      it("the thread of a run Resume can continue is not called final; a picked earlier run's is", async () => {
        await showPanel(failedProps({ resumeRunId: "run-2" }));
        expect(byTest(wrapper, "rca-thread-final-text").text()).toBe(
          "This run stopped before it finished. Resume run continues from the last finished step.",
        );

        await wrapper.setProps({ viewedRun: rcaRunItem(), threadRunId: "run-1" });
        await flushPromises();
        expect(byTest(wrapper, "rca-thread-final-text").text()).toBe(
          "This run no longer takes messages. Re-analyze to start a new version.",
        );
      });

      it("the resume_run blind spot of the latest run emits resume-rca", async () => {
        answers.runSummary = rcaRunSummaryCancelled({
          state: "failed",
          blind_spots: [rcaBlindSpot({ fix: "resume_run" })],
        });
        await showPanel(failedProps({ resumeRunId: "run-2" }));

        const button = wrapper.find('[data-fix="resume_run"]');
        expect(button.text()).toBe("Resume run");
        await button.trigger("click");
        expect(wrapper.emitted("resume-rca")).toEqual([["run-2"]]);
      });

      it("while resuming, Retry is disabled", async () => {
        await showPanel(failedProps({ resumeRunId: "run-2", resuming: true }));

        expect(byTest(wrapper, "rca-retry-btn").attributes("disabled")).toBeDefined();
      });
    });
  });

  describe("W4: assistant flag off keeps the old incident-page controls", () => {
    beforeAll(() => setAssistantFlag(false));
    afterAll(() => setAssistantFlag(true));

    it("a live run shows Cancel run on the bar, which cancels with no confirm", async () => {
      wrapper = mountPanel(liveProps());
      await flushPromises();

      await byTest(wrapper, "rca-cancel-btn").trigger("click");
      expect(wrapper.emitted("cancel-rca")).toHaveLength(1);
      expect(document.body.textContent).not.toContain("Cancel run?");
    });

    it("the re-analyzing banner keeps its own Cancel", async () => {
      wrapper = mountPanel(
        liveProps({
          rca: rcaSummary({ current_run: rcaRun({ mode: "build_on_previous" }) }),
          reportRun: rcaRunItem(),
          reportText: REPORT,
        }),
      );
      await flushPromises();

      await byTest(wrapper, "rca-banner-cancel-btn").trigger("click");
      expect(wrapper.emitted("cancel-rca")).toHaveLength(1);
    });

    it("a finished run keeps Re-analyze on the bar and the old final note", async () => {
      wrapper = mountPanel(completedProps());
      await flushPromises();

      expect(byTest(wrapper, "rca-thread-reanalyze").exists()).toBe(false);
      expect(byTest(wrapper, "rca-thread-final-text").text()).toBe(
        "This report is final and won't change. To redirect the agent, Re-analyze. It creates a new version in Report history.",
      );
      await byTest(wrapper, "rca-reanalyze-btn").trigger("click");
      expect(wrapper.findComponent(RcaGuidanceDialog).props("open")).toBe(true);
    });
  });
});
