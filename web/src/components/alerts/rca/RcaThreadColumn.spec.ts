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

import { describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import RcaThreadColumn from "./RcaThreadColumn.vue";
import { rcaStep, rcaThread } from "@/test/unit/fixtures/rcaThread";

const mountColumn = (props: Record<string, unknown> = {}) =>
  mount(RcaThreadColumn, {
    props: {
      thread: rcaThread(),
      status: "ready",
      runLive: true,
      runState: "running",
      ...props,
    },
    global: { plugins: [i18n] },
  });

const byTest = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`);

const SAVED = {
  thread: rcaThread({
    active: false,
    report_submitted: true,
    steps: [rcaStep(), rcaStep({ index: 2, title: "Converge", stage: "converge" })],
  }),
  runLive: false,
  runState: "completed",
};

describe("RcaThreadColumn", () => {
  describe("TH37: stats line", () => {
    it('shows "9 checks · 27 tool calls · 4m12s" and no credits', () => {
      const wrapper = mountColumn();

      const stats = byTest(wrapper, "rca-thread-stats").text();
      expect(stats).toBe("9 checks · 27 tool calls · 4m12s");
      expect(wrapper.text().toLowerCase()).not.toContain("credit");
    });

    it("uses the singular for one check and one tool call", () => {
      const wrapper = mountColumn({
        thread: rcaThread({ stats: { steps: 1, tool_calls: 1, duration_ms: 12_000 } }),
      });

      expect(byTest(wrapper, "rca-thread-stats").text()).toBe("1 check · 1 tool call · 12s");
    });

    const RUN_STATS = { steps: 5, tool_calls: 11, duration_ms: 107_000, credits: 3 };

    it.each([
      ["transcript none", { thread: rcaThread({ transcript: "none", steps: [], started: null }) }],
      ["410 expired", { thread: null, status: "expired" }],
      ["410 transcript_incomplete", { thread: null, status: "incomplete" }],
      ["503 unavailable", { thread: null, status: "unavailable" }],
    ])("m5: falls back to the run's stats for %s", (_case, props) => {
      const wrapper = mountColumn({
        ...props,
        runLive: false,
        runState: "completed",
        runStats: RUN_STATS,
      });

      expect(byTest(wrapper, "rca-thread-stats").text()).toBe("5 checks · 11 tool calls · 1m47s");
      expect(wrapper.text().toLowerCase()).not.toContain("credit");
    });

    it("prefers the thread's stats over the run's when the transcript is available", () => {
      const wrapper = mountColumn({ runStats: RUN_STATS });

      expect(byTest(wrapper, "rca-thread-stats").text()).toBe("9 checks · 27 tool calls · 4m12s");
    });

    it("shows no stats line when the run's stats are incomplete", () => {
      const wrapper = mountColumn({
        thread: null,
        status: "expired",
        runLive: false,
        runStats: { steps: 2 },
      });

      expect(byTest(wrapper, "rca-thread-stats").exists()).toBe(false);
    });
  });

  describe("TH38: live thread (frame A)", () => {
    it("has the title, the Live pill and the step count", () => {
      const wrapper = mountColumn();

      expect(wrapper.find("h2").text()).toBe("Investigation thread");
      expect(byTest(wrapper, "rca-thread-live-pill").text()).toBe("Live");
      expect(byTest(wrapper, "rca-thread-saved-pill").exists()).toBe(false);
      expect(byTest(wrapper, "rca-thread-step-count").text()).toBe("2 steps");
    });

    it('starts with "Analysis started": trigger, time and prompt', () => {
      const wrapper = mountColumn({ triggerLabel: "Auto on incident open" });

      const start = byTest(wrapper, "rca-thread-start");
      expect(start.text()).toContain("Analysis started");
      expect(byTest(wrapper, "rca-thread-start-trigger").text()).toBe("Auto on incident open");
      expect(start.text()).toContain("08:53:20");
      expect(byTest(wrapper, "rca-thread-start-prompt").text()).toBe(
        "Analyze incident checkout-errors (3 alerts, P1).",
      );
    });

    it('lists "Context used" tagged "Leads, not evidence"', async () => {
      const wrapper = mountColumn({
        contextUsed: {
          past_causes: [{ id: "pc-1", summary: "Bad deploy of checkout" }],
          skills: ["k8s-debug"],
          toolsets: ["github", "pagerduty"],
        },
      });
      const toggle = byTest(wrapper, "rca-thread-context-toggle");
      expect(toggle.text()).toBe("Context used · 1 past cause · 1 skill · 2 toolsets");
      expect(byTest(wrapper, "rca-thread-context").exists()).toBe(false);

      await toggle.trigger("click");

      // a11y: the toggle controls the panel it opens.
      const controls = toggle.attributes("aria-controls");
      expect(controls).toBeTruthy();
      expect(wrapper.find(`[id="${controls}"]`).attributes("data-test")).toBe("rca-thread-context");

      const context = byTest(wrapper, "rca-thread-context");
      expect(context.text()).toContain("Leads, not evidence");
      expect(context.findAll("p").map((p) => p.text())).toEqual([
        "Bad deploy of checkout · Past cause",
        "k8s-debug · Skill",
        "github · AI Toolset",
        "pagerduty · AI Toolset",
      ]);
    });

    it("hides Context used when the run had none", () => {
      const wrapper = mountColumn({ contextUsed: { past_causes: [], skills: [], toolsets: [] } });

      expect(byTest(wrapper, "rca-thread-context-toggle").exists()).toBe(false);
    });

    it("renders one entry per step; the running step shows the running text", () => {
      const wrapper = mountColumn();

      const steps = wrapper.findAll('[data-test="rca-thread-step"]');
      expect(steps.map((s) => s.find('[data-test="rca-thread-step-title"]').text())).toEqual([
        "Load incident context",
        "Map the checkout dependencies",
      ]);
      expect(steps[0].findAll('[data-test="rca-citation-chip"]')).toHaveLength(2);
      expect(steps[1].find('[data-test="rca-thread-step-working"]').text()).toBe(
        "Working. Messages sent now are read after this turn.",
      );
      // The running step carries the working line; no extra row.
      expect(byTest(wrapper, "rca-thread-working").exists()).toBe(false);
      expect(byTest(wrapper, "rca-thread-final-note").exists()).toBe(false);
    });

    it("shows the working row while live between steps", () => {
      const wrapper = mountColumn({ thread: rcaThread({ steps: [rcaStep()] }) });

      const working = byTest(wrapper, "rca-thread-working");
      expect(working.text()).toBe("Working. Messages sent now are read after this turn.");
      expect(working.find('p[role="status"]').text()).toBe(
        "Working. Messages sent now are read after this turn.",
      );
    });
  });

  describe("TH38: saved thread (frame B)", () => {
    it("shows the Saved pill, no running text, and the final note", () => {
      const wrapper = mountColumn(SAVED);

      expect(byTest(wrapper, "rca-thread-saved-pill").text()).toBe("Saved");
      expect(byTest(wrapper, "rca-thread-live-pill").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Working.");
      expect(byTest(wrapper, "rca-thread-final-note").text()).toBe(
        "This report is final and won't change. To redirect the agent, Re-analyze. It creates a new version in Report history.",
      );
    });

    it("a cancelled run has no final note", () => {
      const wrapper = mountColumn({ ...SAVED, runState: "cancelled" });

      expect(byTest(wrapper, "rca-thread-final-note").exists()).toBe(false);
    });
  });

  describe("transcript and load states", () => {
    it.each([
      ["none", "This run has no stored transcript."],
      ["expired", "The transcript of this run is no longer stored."],
    ])("transcript %s shows its message and no stats", (transcript, message) => {
      const wrapper = mountColumn({
        thread: rcaThread({
          transcript: transcript as "none" | "expired",
          steps: [],
          started: null,
        }),
        runLive: false,
        runState: "completed",
      });

      expect(byTest(wrapper, "rca-thread-empty").text()).toBe(message);
      expect(byTest(wrapper, "rca-thread-stats").exists()).toBe(false);
      expect(byTest(wrapper, "rca-thread-step-count").exists()).toBe(false);
    });

    it.each([
      ["expired", "The transcript of this run is no longer stored."],
      ["incomplete", "Part of this run's transcript was lost, so the thread cannot be shown."],
      ["unavailable", "The thread could not be loaded."],
      ["missing", "The thread could not be loaded."],
      ["unsupported", "The thread could not be loaded."],
      ["idle", "No run to show."],
    ])("status %s shows its message", (status, message) => {
      const wrapper = mountColumn({ thread: null, status, runLive: false, runState: null });

      expect(byTest(wrapper, "rca-thread-empty").find("p").text()).toBe(message);
      expect(wrapper.findAll('[data-test="rca-thread-step"]')).toHaveLength(0);
    });

    it("shows the loading line on the first read", () => {
      const wrapper = mountColumn({ thread: null, status: "loading" });

      expect(byTest(wrapper, "rca-thread-loading").text()).toBe("Loading the thread…");
    });

    it("a non-live run whose read failed shows Retry, which emits retry", async () => {
      const wrapper = mountColumn({
        thread: null,
        status: "unavailable",
        runLive: false,
        runState: "completed",
      });

      const retry = byTest(wrapper, "rca-thread-retry-btn");
      expect(retry.text()).toBe("Retry");
      await retry.trigger("click");
      expect(wrapper.emitted("retry")).toHaveLength(1);
    });

    it.each([
      ["a live run (its poll retries)", { status: "unavailable", runLive: true }],
      ["an expired transcript", { status: "expired", runLive: false }],
      ["an incomplete transcript", { status: "incomplete", runLive: false }],
      ["a missing run", { status: "missing", runLive: false }],
    ])("shows no Retry for %s", (_case, props) => {
      const wrapper = mountColumn({ thread: null, ...props });

      expect(byTest(wrapper, "rca-thread-retry-btn").exists()).toBe(false);
    });
  });
});
