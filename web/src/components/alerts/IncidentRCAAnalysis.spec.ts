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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

import IncidentRCAAnalysis from "./IncidentRCAAnalysis.vue";
import i18n from "@/locales";
import type { RcaRun, RcaRunItem, RcaSummary } from "@/services/incidents";
import { formatTimestamp } from "@/utils/date";

// ==================== FIXTURES ====================

const T0 = 1_760_000_000_000_000; // microseconds

function runItem(overrides: Partial<RcaRunItem> = {}): RcaRunItem {
  return {
    run_id: "run-1",
    subject_type: "incident",
    trigger: "auto_new_incident",
    mode: "fresh",
    started_by: "system",
    state: "completed",
    started_at: T0,
    ended_at: T0 + 60_000_000,
    outcome: null,
    confidence: null,
    cancelled_by: null,
    error_reason: null,
    ...overrides,
  };
}

function currentRun(overrides: Partial<RcaRun> = {}): RcaRun {
  return {
    run_id: "run-2",
    subject_type: "incident",
    subject_id: "inc-1",
    incident_id: "inc-1",
    trigger: "reanalyze",
    mode: "fresh",
    started_by: "a.rao@acme.io",
    guidance: null,
    state: "running",
    started_at: T0 + 120_000_000,
    updated_at: T0 + 120_000_000,
    ended_at: null,
    cancelled_by: null,
    outcome: null,
    confidence: null,
    report: null,
    result: null,
    error: null,
    session_id: null,
    stats: null,
    ...overrides,
  };
}

function summary(overrides: Partial<RcaSummary> = {}): RcaSummary {
  return {
    run_id: "run-2",
    state: "running",
    stale: false,
    started_at: T0 + 120_000_000,
    updated_at: T0 + 120_000_000,
    outcome: null,
    confidence: null,
    summary: {
      stage: null,
      stage_index: null,
      stage_count: 0,
      steps: 0,
      tool_calls: 0,
      steered_by: [],
      unblocked_by: null,
      detail: null,
      deadline_at: null,
      cancelled_by: null,
      previous: null,
    },
    ...overrides,
  };
}

const REPORT_HTML = "<p>Root cause: memory leak in payment service</p>";

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
    props: { isDarkMode: false, ...props },
    global: { plugins: [i18n], stubs },
  });
}

const byTest = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`);

// ==================== TESTS ====================

describe("IncidentRCAAnalysis", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    toastMock.mockClear();
  });

  describe("No run yet", () => {
    it("offers the first run and emits a fresh trigger", async () => {
      wrapper = mountPanel();

      expect(byTest(wrapper, "rca-existing-container").exists()).toBe(false);
      await byTest(wrapper, "trigger-rca-btn").trigger("click");

      expect(wrapper.emitted("trigger-rca")).toEqual([[{ buildOnPrevious: false }]]);
    });
  });

  describe("Live run", () => {
    it("first run shows the analyzing banner with Cancel and no trigger button", async () => {
      wrapper = mountPanel({ rca: summary({ current_run: currentRun() }) });

      expect(byTest(wrapper, "rca-inflight-container").exists()).toBe(true);
      expect(byTest(wrapper, "trigger-rca-btn").exists()).toBe(false);
      await byTest(wrapper, "rca-cancel-btn").trigger("click");
      expect(wrapper.emitted("cancel-rca")).toHaveLength(1);
    });

    it("a re-run names its mode and keeps the earlier report readable below", () => {
      wrapper = mountPanel({
        rca: summary({ current_run: currentRun({ mode: "build_on_previous" }) }),
        reportRun: runItem(),
        formattedRcaContent: REPORT_HTML,
      });

      expect(byTest(wrapper, "rca-inflight-message").text()).toBe(
        "Building on the previous report…",
      );
      expect(byTest(wrapper, "rca-existing-content").html()).toContain("memory leak");
    });

    it("the earlier-report note names the run actually shown (a picked earlier run)", () => {
      const reportRun = runItem({ run_id: "run-5", started_at: T0 });
      const viewedRun = runItem({ run_id: "run-2", started_at: T0 - 3 * 3_600_000_000 });
      wrapper = mountPanel({
        rca: summary({ state: "failed", current_run: currentRun({ state: "failed" }) }),
        error: { code: "x", reason: "Agent unavailable", details: null, trigger_type: null },
        reportRun,
        viewedRun,
        history: [reportRun, viewedRun],
        formattedRcaContent: REPORT_HTML,
      });

      const note = byTest(wrapper, "rca-earlier-report-note").text();
      expect(note).toBe(
        `The report below is from the ${formatTimestamp(viewedRun.started_at, "HH:mm")} run.`,
      );
      expect(note).not.toContain(formatTimestamp(reportRun.started_at, "HH:mm"));
    });

    it("disables Cancel while the cancel is in flight", () => {
      wrapper = mountPanel({ rca: summary(), cancelling: true });

      expect(byTest(wrapper, "rca-cancel-btn").attributes("disabled")).toBeDefined();
    });

    it("server stale flag shows the stale banner, still cancellable", async () => {
      wrapper = mountPanel({ rca: summary({ stale: true }), stale: true });

      expect(byTest(wrapper, "rca-stale-banner").exists()).toBe(true);
      expect(byTest(wrapper, "rca-inflight-container").exists()).toBe(false);
      await byTest(wrapper, "rca-cancel-btn").trigger("click");
      expect(wrapper.emitted("cancel-rca")).toHaveLength(1);
    });
  });

  describe("RR-47: failed latest run with an earlier completed run", () => {
    const failedProps = () => ({
      rca: summary({
        state: "failed",
        current_run: currentRun({ state: "failed", ended_at: T0 + 180_000_000 }),
      }),
      error: {
        code: "agent_unavailable",
        reason: "Agent unavailable",
        details: "connect ECONNREFUSED 10.0.0.4:8080",
        trigger_type: null,
      },
      reportRun: runItem(),
      formattedRcaContent: REPORT_HTML,
    });

    it("shows the reason as heading, details collapsed behind Show details, no toast", async () => {
      wrapper = mountPanel(failedProps());

      expect(byTest(wrapper, "rca-error-banner").exists()).toBe(true);
      expect(byTest(wrapper, "rca-error-reason").text()).toBe("Agent unavailable");
      expect(byTest(wrapper, "rca-error-details").exists()).toBe(false);
      const toggle = byTest(wrapper, "rca-error-details-toggle");
      expect(toggle.text()).toBe("Show details");
      expect(toggle.attributes("aria-expanded")).toBe("false");

      await toggle.trigger("click");

      expect(byTest(wrapper, "rca-error-details").text()).toContain("ECONNREFUSED");
      expect(byTest(wrapper, "rca-existing-content").html()).toContain("memory leak");
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("Retry offers both modes with the failed run's mode first", async () => {
      wrapper = mountPanel(failedProps());

      const items = wrapper
        .findAll('[data-test^="rca-retry-"]')
        .map((w) => w.attributes("data-test"));
      expect(items).toEqual(["rca-retry-btn", "rca-retry-fresh", "rca-retry-build"]);
      await byTest(wrapper, "rca-retry-build").trigger("click");
      expect(wrapper.emitted("trigger-rca")).toEqual([[{ buildOnPrevious: true }]]);
    });

    it("without an earlier report offers a plain Retry", async () => {
      wrapper = mountPanel({ ...failedProps(), reportRun: null, formattedRcaContent: "" });

      expect(byTest(wrapper, "rca-retry-fresh").exists()).toBe(false);
      await byTest(wrapper, "rca-retry-btn").trigger("click");
      expect(wrapper.emitted("trigger-rca")).toEqual([[{ buildOnPrevious: false }]]);
    });
  });

  describe("Cancelled latest run", () => {
    it("names who cancelled it", () => {
      wrapper = mountPanel({
        rca: summary({
          state: "cancelled",
          current_run: currentRun({
            state: "cancelled",
            cancelled_by: "a.rao@acme.io",
            ended_at: T0 + 180_000_000,
          }),
        }),
      });

      expect(byTest(wrapper, "rca-cancelled-message").text()).toMatch(
        /^Cancelled by a\.rao at \d{2}:\d{2}:\d{2} UTC after 1m\.$/,
      );
    });
  });

  describe("Report", () => {
    it("renders the report and emits copy and download", async () => {
      wrapper = mountPanel({
        rca: summary({ state: "completed" }),
        reportRun: runItem(),
        formattedRcaContent: REPORT_HTML,
      });

      expect(byTest(wrapper, "rca-existing-content").html()).toContain("memory leak");
      await byTest(wrapper, "rca-copy-btn").trigger("click");
      await byTest(wrapper, "rca-download-btn").trigger("click");
      expect(wrapper.emitted("copy-report")).toHaveLength(1);
      expect(wrapper.emitted("download-report")).toHaveLength(1);
    });

    it("shows a loading line while the report text loads", () => {
      wrapper = mountPanel({ reportRun: runItem(), reportLoading: true });

      expect(byTest(wrapper, "rca-report-loading").exists()).toBe(true);
      expect(byTest(wrapper, "rca-existing-container").exists()).toBe(false);
    });

    it("Re-analyze offers fresh and build-on-previous", async () => {
      wrapper = mountPanel({
        rca: summary({ state: "completed" }),
        reportRun: runItem(),
        formattedRcaContent: REPORT_HTML,
      });

      await byTest(wrapper, "rca-reanalyze-fresh").trigger("click");
      await byTest(wrapper, "rca-reanalyze-build").trigger("click");
      expect(wrapper.emitted("trigger-rca")).toEqual([
        [{ buildOnPrevious: false }],
        [{ buildOnPrevious: true }],
      ]);
    });
  });

  describe("RR-36: run history", () => {
    const history = [
      runItem({ run_id: "run-5", trigger: "reanalyze", started_by: "a.rao@acme.io" }),
      runItem({ run_id: "run-4", trigger: "manual", started_by: "j.doe@acme.io", state: "failed" }),
      runItem({ run_id: "run-3", trigger: "auto_reopen", state: "cancelled" }),
      runItem({ run_id: "run-2", trigger: "oncall_page" }),
      runItem({ run_id: "run-1", trigger: "legacy", started_by: "" }),
    ];

    it("hides the picker with a single run", () => {
      wrapper = mountPanel({ reportRun: history[0], history: [history[0]] });

      expect(byTest(wrapper, "rca-history-btn").exists()).toBe(false);
    });

    it("labels each item by its trigger and marks failed and cancelled runs", () => {
      wrapper = mountPanel({ reportRun: history[0], history, formattedRcaContent: REPORT_HTML });

      const labels = wrapper.findAll('[data-test="rca-history-item-label"]').map((w) => w.text());
      expect(labels).toEqual([
        "Re-analyze by a.rao",
        "Analysis by j.doe",
        "Auto on reopen",
        "On-call page",
        "Earlier report",
      ]);
      expect(byTest(wrapper, "rca-history-item-1").text()).toContain("Failed");
      expect(byTest(wrapper, "rca-history-item-2").text()).toContain("Cancelled");
      // Only completed runs other than the displayed one open.
      expect(byTest(wrapper, "rca-history-item-0").attributes("data-disabled")).toBe("true");
      expect(byTest(wrapper, "rca-history-item-1").attributes("data-disabled")).toBe("true");
      expect(byTest(wrapper, "rca-history-item-3").attributes("data-disabled")).toBe("false");
    });

    it("picking an earlier run emits its id; the archived banner goes back", async () => {
      wrapper = mountPanel({ reportRun: history[0], history, formattedRcaContent: REPORT_HTML });

      await byTest(wrapper, "rca-history-item-3").trigger("click");
      expect(wrapper.emitted("view-run")).toEqual([["run-2"]]);

      await wrapper.setProps({ viewedRun: history[3] });
      await flushPromises();
      expect(byTest(wrapper, "rca-archived-banner").exists()).toBe(true);
      await byTest(wrapper, "rca-back-to-current-btn").trigger("click");
      expect(wrapper.emitted("view-run")?.[1]).toEqual([null]);
    });
  });
});
