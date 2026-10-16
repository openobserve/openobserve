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
vi.mock("@/services/incidents", () => ({ default: { getRcaThread: vi.fn() } }));

import IncidentRCAAnalysis from "./IncidentRCAAnalysis.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import incidentsService from "@/services/incidents";
import { formatTimestamp } from "@/utils/date";
import { RCA_UNFINISHED_TOOL_ERROR, rcaThreadPlainText } from "@/utils/incidents/rcaThread";
import {
  RCA_T0,
  rcaRun,
  rcaRunItem,
  rcaStep,
  rcaSummary,
  rcaThread,
  rcaToolCall,
  sec,
} from "@/test/unit/fixtures/rcaThread";

const getRcaThread = vi.mocked(incidentsService.getRcaThread);

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
    writeText.mockReset().mockResolvedValue(undefined);
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

    it("shows a loading line while the report text loads", () => {
      wrapper = mountPanel({ ...completedProps(), reportText: "", reportLoading: true });

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
});
