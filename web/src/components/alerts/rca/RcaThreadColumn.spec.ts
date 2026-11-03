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

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import RcaThreadColumn from "./RcaThreadColumn.vue";
import type { RcaSteerRecord } from "@/services/incidents";
import type { RcaSteerSendResult } from "@/composables/useRcaSteering";
import { raw } from "@/types/i18n";
import {
  RCA_T0,
  rcaSteerRecord,
  rcaSteering,
  rcaSteeringLive,
  rcaSteeringPaused,
  rcaSteeringUnblocked,
  rcaStep,
  rcaThread,
  rcaThreadQuestion,
  sec,
} from "@/test/unit/fixtures/rcaThread";

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

    it("a run waiting for an answer shows no working row or running step", () => {
      const paused = mountColumn({
        thread: rcaThread({ steps: [rcaStep()] }),
        runState: "waiting_input",
      });
      expect(byTest(paused, "rca-thread-working").exists()).toBe(false);

      const pausedMidStep = mountColumn({ runState: "waiting_input" });
      expect(pausedMidStep.find('[data-test="rca-thread-step-working"]').exists()).toBe(false);
    });

    it("keeps following the newest step while it grows, for a reader at the bottom", async () => {
      const scrollTo = vi.fn();
      const wrapper = mountColumn();
      const area = wrapper.find(".overflow-auto").element as HTMLElement;
      Object.defineProperties(area, {
        scrollHeight: { configurable: true, value: 1000 },
        clientHeight: { configurable: true, value: 400 },
        scrollTop: { configurable: true, value: 600 },
      });
      area.scrollTo = scrollTo;
      const thread = rcaThread();
      const last = thread.steps.at(-1)!;

      await wrapper.setProps({
        thread: { ...thread, steps: [...thread.steps.slice(0, -1), { ...last, ended_at: RCA_T0 }] },
      });
      await flushPromises();

      expect(scrollTo).toHaveBeenCalled();
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

    it.each(["cancelled", "failed"] as const)(
      "SG37: a %s run shows the finished note too",
      (runState) => {
        const wrapper = mountColumn({ ...SAVED, runState });

        expect(byTest(wrapper, "rca-thread-final-note").exists()).toBe(true);
        expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(false);
      },
    );

    // The projection closes every step of an ended run; a Resume keeps only `reusable_steps`.
    const ENDED_THREAD = rcaThread({
      active: false,
      report_submitted: false,
      reusable_steps: 1,
      steps: [
        rcaStep(),
        rcaStep({ index: 2, title: "Map the services", stage: "topology" }),
        rcaStep({ index: 3, title: "Check recent deploys", stage: "changes" }),
      ],
    });
    const CANCELLED = { thread: ENDED_THREAD, runLive: false, runState: "cancelled" };
    const stepStatuses = (wrapper: VueWrapper) =>
      wrapper
        .findAll('[data-test="rca-thread-step-status"] [aria-label]')
        .map((icon) => icon.attributes("aria-label"));

    it.each(["cancelled", "failed"] as const)(
      "a %s run's steps past the Resume count did not finish, as the banner counts them",
      (runState) => {
        const wrapper = mountColumn({ ...CANCELLED, runState });

        expect(stepStatuses(wrapper)).toEqual([
          "A tool call failed",
          "Step did not finish",
          "Step did not finish",
        ]);
      },
    );

    it("a completed run finished every closed step, also one the answer deadline ended without a report", () => {
      expect(stepStatuses(mountColumn(SAVED))).toEqual([
        "A tool call failed",
        "A tool call failed",
      ]);
      expect(stepStatuses(mountColumn({ ...CANCELLED, runState: "completed" }))).toEqual([
        "A tool call failed",
        "A tool call failed",
        "A tool call failed",
      ]);
    });

    it("a run Resume can continue says so instead of calling itself final", () => {
      const wrapper = mountColumn({ ...CANCELLED, canResume: true });

      expect(byTest(wrapper, "rca-thread-final-note").text()).toBe(
        "This run stopped before it finished. Resume run continues from the last finished step.",
      );
      expect(wrapper.text()).not.toContain("final");
    });

    it("a cancelled run Resume cannot continue keeps the final note", () => {
      const wrapper = mountColumn(CANCELLED);

      expect(byTest(wrapper, "rca-thread-final-note").text()).toContain("This report is final");
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

    it("a live run whose session is not stored yet shows the working line, not 'no longer stored'", () => {
      const wrapper = mountColumn({ thread: null, status: "expired", runLive: true });

      expect(byTest(wrapper, "rca-thread-working").exists()).toBe(true);
      expect(byTest(wrapper, "rca-thread-empty").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("no longer stored");
    });

    it("a run with no transcript to read (v1) shows the no-transcript message, not 'No run'", () => {
      const wrapper = mountColumn({
        thread: null,
        status: "idle",
        noTranscript: true,
        runLive: false,
        runState: "completed",
      });

      expect(byTest(wrapper, "rca-thread-empty").find("p").text()).toBe(
        "This run has no stored transcript.",
      );
      expect(byTest(wrapper, "rca-thread-retry-btn").exists()).toBe(false);
    });

    it("a thread whose end was lost shows the saved part under a notice", () => {
      const wrapper = mountColumn({
        ...SAVED,
        thread: rcaThread({ ...SAVED.thread, truncated: true, saved_through_seq: 41 }),
      });

      expect(byTest(wrapper, "rca-thread-truncated").text()).toBe(
        "The end of this transcript was lost. The thread shows the part that was saved.",
      );
      expect(wrapper.findAll('[data-test="rca-thread-step"]')).toHaveLength(2);
      expect(byTest(mountColumn(SAVED), "rca-thread-truncated").exists()).toBe(false);
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

    it("a steering read failure shows its own notice with Retry, apart from the thread", async () => {
      const wrapper = mountColumn({ steeringStatus: "unavailable" });

      expect(wrapper.findAll('[data-test="rca-thread-step"]').length).toBeGreaterThan(0);
      const retry = byTest(wrapper, "rca-thread-steering-retry-btn");
      await retry.trigger("click");
      expect(wrapper.emitted("retry")).toHaveLength(1);
      expect(byTest(mountColumn(), "rca-thread-steering-failed").exists()).toBe(false);
    });
  });

  describe("F9: evidence numbers on the note chips", () => {
    it("passes the summary's numbers to the steps and re-emits a chip click as open-evidence", async () => {
      const wrapper = mountColumn({ ...SAVED, evidenceNumbers: new Map([["e3", 1]]) });

      const step = wrapper.findAll('[data-test="rca-thread-step"]')[0];
      expect(step.findAll('[data-test="rca-citation-chip"]').map((chip) => chip.text())).toEqual([
        "1",
      ]);
      expect(step.find('[data-test="rca-citation-unverified"]').text()).toBe("e7 · not verified");

      await step.find('[data-test="rca-citation-chip"]').trigger("click");
      expect(wrapper.emitted("open-evidence")).toEqual([[1]]);
    });
  });

  describe("04 steering (SG37–SG40)", () => {
    const send = vi.fn(async () => ({ ok: true as const, runState: "running" as const }));
    const STEERABLE = {
      steering: rcaSteeringLive(),
      canSteer: true,
      authorEmail: "a.rao@acme.io",
      send,
    };
    const bubbles = (wrapper: VueWrapper) => wrapper.findAll('[data-test="rca-thread-steer"]');

    it("SG37: the composer shows only with can_steer", () => {
      const wrapper = mountColumn(STEERABLE);

      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(true);
      expect(byTest(wrapper, "rca-thread-final-note").exists()).toBe(false);
    });

    it("SG37: a reader without RCA permission sees the thread and no composer", () => {
      const wrapper = mountColumn({ ...STEERABLE, steering: null, canSteer: false });

      expect(wrapper.findAll('[data-test="rca-thread-step"]').length).toBeGreaterThan(0);
      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(false);
    });

    it("SG37: a finished run shows the finished note even with a steering view", () => {
      const wrapper = mountColumn({
        ...SAVED,
        steering: rcaSteeringLive({ can_steer: false }),
        canSteer: false,
        send,
      });

      expect(byTest(wrapper, "rca-thread-final-note").exists()).toBe(true);
      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(false);
    });

    it("SG37: the paused composer shows 'Agent asks …' and the answer note", () => {
      const wrapper = mountColumn({
        ...STEERABLE,
        runState: "waiting_input",
        steering: rcaSteeringPaused(),
      });

      expect(byTest(wrapper, "rca-steer-question").text()).toContain("Agent asks:");
      expect(byTest(wrapper, "rca-steer-question").text()).toContain(
        "Which change went out to checkout-api around 14:02?",
      );
      expect(byTest(wrapper, "rca-steer-answer-note").text()).toBe(
        "Your answer is a lead, not evidence. It can move the hypothesis to Likely. Root cause needs a tool result.",
      );
    });

    it("SG38: each status renders its exact pill label", () => {
      const statuses: [Partial<RcaSteerRecord>, string][] = [
        [{ status: "queued" }, "Queued · read after this turn"],
        [{ status: "delivered" }, "Queued · read after this turn"],
        [{ status: "read" }, "Read by the agent"],
        [{ status: "applied" }, "Applied"],
        [{ status: "declined", agent_note: "Out of scope." }, "Declined"],
        [{ status: "not_read" }, "Not read · the run ended first"],
        [{ status: "rejected", status_reason: "no_active_turn" }, "Not sent · no step was running"],
        [{ status: "rejected" }, "Not sent"],
      ];
      const items = statuses.map(([overrides], idx) =>
        rcaSteerRecord({
          steer_id: `stg_${idx}`,
          created_at: RCA_T0 + sec(100 + idx),
          ...overrides,
        }),
      );
      const wrapper = mountColumn({ steering: rcaSteering({ items }) });

      expect(
        bubbles(wrapper).map((bubble) => bubble.find('[data-test="rca-thread-steer-pill"]').text()),
      ).toEqual(statuses.map(([, label]) => label));
      expect(bubbles(wrapper)[4].find('[data-test="rca-thread-steer-note"]').text()).toBe(
        "Agent: Out of scope.",
      );
    });

    it("SG38: an answer adds 'Lead, not evidence'; a message does not", () => {
      const wrapper = mountColumn({
        steering: rcaSteering({
          items: [
            rcaSteerRecord({ steer_id: "a", kind: "answer", status: "read" }),
            rcaSteerRecord({ steer_id: "m", created_at: RCA_T0 + sec(201) }),
          ],
        }),
      });

      const [answer, message] = bubbles(wrapper);
      expect(answer.find('[data-test="rca-thread-steer-lead"]').text()).toBe("Lead, not evidence");
      expect(message.find('[data-test="rca-thread-steer-lead"]').exists()).toBe(false);
    });

    it("the bubble shows author, plain text and sits after the earlier steps", () => {
      const wrapper = mountColumn({
        steering: rcaSteering({
          items: [rcaSteerRecord({ text: "<b>raw</b> text" })],
        }),
      });

      const bubble = bubbles(wrapper)[0];
      expect(bubble.text()).toContain("a.rao");
      expect(bubble.find('[data-test="rca-thread-steer-text"]').text()).toBe("<b>raw</b> text");
      expect(bubble.find("b").exists()).toBe(false);
      const steps = wrapper.findAll('[data-test="rca-thread-step"]');
      expect(
        steps[steps.length - 1].element.compareDocumentPosition(bubble.element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it.each<[string, Partial<RcaSteerRecord>, boolean]>([
      ["rejected · finalizing", { status: "rejected", status_reason: "finalizing" }, true],
      ["not_read", { status: "not_read" }, true],
      ["rejected · no_active_turn", { status: "rejected", status_reason: "no_active_turn" }, false],
      ["applied", { status: "applied" }, false],
    ])("SG40: %s offers Re-analyze with this message: %s", async (_name, overrides, offers) => {
      const wrapper = mountColumn({
        steering: rcaSteering({ items: [rcaSteerRecord({ text: "Check PR #812", ...overrides })] }),
      });

      const button = byTest(wrapper, "rca-thread-steer-reanalyze");
      expect(button.exists()).toBe(offers);
      if (!offers) return;
      expect(button.text()).toBe("Re-analyze with this message");
      await button.trigger("click");
      expect(wrapper.emitted("reanalyze-with")).toEqual([["Check PR #812"]]);
    });

    it("SG39: an open question shows 'Needs input' and 'Waiting for an answer'", () => {
      const wrapper = mountColumn({
        thread: rcaThread({ questions: [rcaThreadQuestion()] }),
        runState: "waiting_input",
        steering: rcaSteeringPaused(),
      });

      const question = byTest(wrapper, "rca-thread-question");
      expect(question.text()).toContain("Needs input");
      expect(question.find('[data-test="rca-thread-question-status"]').text()).toBe(
        "Waiting for an answer",
      );
    });

    it("SG39: an answered question shows 'Answered by <author>'", () => {
      const wrapper = mountColumn({
        ...SAVED,
        thread: rcaThread({
          active: false,
          questions: [rcaThreadQuestion({ answered_by: "a.rao@acme.io" })],
        }),
        steering: rcaSteeringUnblocked(),
      });

      expect(byTest(wrapper, "rca-thread-question-status").text()).toBe("Answered by a.rao");
    });

    it("frames F, G: the stats line adds 'steered N×' when > 0", () => {
      const steered = mountColumn({ steering: rcaSteeringLive() });
      expect(byTest(steered, "rca-thread-stats").text()).toBe(
        "9 checks · 27 tool calls · 4m12s · steered 2×",
      );

      const none = mountColumn({ steering: rcaSteering() });
      expect(byTest(none, "rca-thread-stats").text()).toBe("9 checks · 27 tool calls · 4m12s");
    });

    it("an answer does not make 'steered N×'", () => {
      const wrapper = mountColumn({ steering: rcaSteeringUnblocked() });
      expect(byTest(wrapper, "rca-thread-stats").text()).toBe("9 checks · 27 tool calls · 4m12s");
    });

    it("the run's stored steered count wins over the view's rows", () => {
      const wrapper = mountColumn({
        steering: rcaSteeringLive(),
        runStats: { steps: 9, tool_calls: 27, duration_ms: 252_000, steered: 3 },
      });
      expect(byTest(wrapper, "rca-thread-stats").text()).toBe(
        "9 checks · 27 tool calls · 4m12s · steered 3×",
      );
    });

    it("SG40: a 409 run_closing keeps the text after the composer hides and offers Re-analyze", async () => {
      const refuse = vi.fn(async () => ({
        ok: false as const,
        code: "run_closing",
        message:
          "The answer window has closed and the run is closing as Blocked. Re-analyze with your message instead.",
      }));
      const wrapper = mountColumn({ ...STEERABLE, send: refuse });
      await wrapper.find("textarea").setValue("PR #812 went out at 14:02");
      await wrapper.find("form").trigger("submit");
      await flushPromises();

      // The run closes: the composer goes, the refused text stays.
      await wrapper.setProps({ canSteer: false, runLive: false, runState: "completed" });
      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(false);
      expect(byTest(wrapper, "rca-thread-refusal").text()).toContain(
        "The answer window has closed and the run is closing as Blocked.",
      );
      expect(byTest(wrapper, "rca-thread-refusal-text").text()).toBe("PR #812 went out at 14:02");

      await byTest(wrapper, "rca-thread-refusal-reanalyze").trigger("click");
      expect(wrapper.emitted("reanalyze-with")).toEqual([["PR #812 went out at 14:02"]]);
      expect(byTest(wrapper, "rca-thread-refusal").exists()).toBe(false);
    });

    it("SG40 race: the composer hides before the refused send resolves; the panel still shows the text", async () => {
      let refuse!: () => void;
      const send = vi.fn(
        () =>
          new Promise<RcaSteerSendResult>((resolve) => {
            refuse = () =>
              resolve({ ok: false, code: "run_closing", message: raw("The run is closing.") });
          }),
      );
      const wrapper = mountColumn({ ...STEERABLE, send });
      await wrapper.find("textarea").setValue("PR #812 went out at 14:02");
      await wrapper.find("form").trigger("submit");

      // A steering read lands first and closes the box while the send still waits.
      await wrapper.setProps({ canSteer: false, runLive: false, runState: "completed" });
      expect(byTest(wrapper, "rca-steer-composer").exists()).toBe(false);
      refuse();
      await flushPromises();

      expect(byTest(wrapper, "rca-thread-refusal").text()).toContain("The run is closing.");
      expect(byTest(wrapper, "rca-thread-refusal-text").text()).toBe("PR #812 went out at 14:02");
    });
  });
});
