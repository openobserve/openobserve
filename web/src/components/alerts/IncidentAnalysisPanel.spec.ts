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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, ref } from "vue";

import i18n from "@/locales";

import { fakeAssistant, fakeRouter, fakeVuex } from "../ai-assistant/__tests__/fakeAssistant";

const { fake, analysis } = vi.hoisted(() => ({
  fake: { current: null as any },
  analysis: { current: null as any },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
  useIncidentAnalysis: () => analysis.current,
}));

const named = (name: string, test: string) =>
  defineComponent({
    name,
    inheritAttrs: false,
    props: { disabledReason: { type: String, default: undefined } },
    setup:
      (props, { attrs }) =>
      () =>
        h("div", {
          "data-test": attrs["data-test"] ?? test,
          "data-reason": props.disabledReason ?? "",
        }),
  });

vi.mock("@/services/incidents", () => ({
  __esModule: true,
  default: { cancelRca: vi.fn(async () => undefined) },
}));

import incidentsService from "@/services/incidents";

import IncidentAnalysisPanel, { RCA_STALE_AFTER_MS } from "./IncidentAnalysisPanel.vue";

function fakeAnalysis() {
  const session = ref<any>(null);
  const gate = ref<any>(null);
  const answer = ref<any>(null);
  const refusal = ref<any>(null);
  return {
    gate: computed(() => gate.value),
    session: computed(() => session.value),
    running: computed(() => {
      const state = session.value?.turn.state;
      return !!state && !["idle", "done", "stopped", "failed", "refused"].includes(state);
    }),
    answer: computed(() => answer.value),
    analyze: vi.fn(async () => ({ state: "done", saved: "not_saved" })),
    stop: vi.fn(async () => undefined),
    resolveConsent: vi.fn(),
    refusal: computed(() => refusal.value),
    dismissRefusal: vi.fn(() => (refusal.value = null)),
    refs: { session, gate, answer, refusal },
  };
}

function mountPanel(props: Record<string, unknown> = {}) {
  fake.current = fakeAssistant();
  analysis.current = fakeAnalysis();
  return mount(IncidentAnalysisPanel, {
    props: { incidentId: "inc-1", incidentTitle: "Checkout errors", ...props },
    global: {
      plugins: [i18n, fakeRouter(), fakeVuex()],
      stubs: {
        AiEntryButton: named("AiEntryButton", "door"),
        AssistantGateState: named("AssistantGateState", "gate"),
        AssistantTurnStatus: named("AssistantTurnStatus", "status"),
        AssistantTurnOutcome: named("AssistantTurnOutcome", "outcome"),
        AssistantMessage: named("AssistantMessage", "message"),
      },
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("IncidentAnalysisPanel", () => {
  it("offers Analyze incident with its time hint before any run", async () => {
    const wrapper = mountPanel();
    expect(wrapper.attributes("data-dd-privacy")).toBe("mask");
    expect(wrapper.get('[data-test="rca-analyze-hint"]').text()).toBe("Usually takes 2–4 minutes");
    await wrapper.get('[data-test="trigger-rca-btn"]').trigger("click");
    await flushPromises();
    expect(analysis.current.analyze).toHaveBeenCalledWith({
      reanalysis: false,
      buildOnPrevious: false,
    });
    expect(wrapper.emitted("completed")).toHaveLength(1);
  });

  it("renders the gate instead of the button, before any click", async () => {
    const wrapper = mountPanel();
    analysis.current.refs.gate.value = { state: "rca_off" };
    await flushPromises();
    expect(wrapper.get('[data-test="rca-gate-state"]').text()).toContain(
      "Incident analysis is off for this organization.",
    );
    expect(wrapper.find('[data-test="trigger-rca-btn"]').exists()).toBe(false);
    analysis.current.refs.gate.value = { state: "ai_off", reason: "not_configured" };
    await flushPromises();
    expect(wrapper.find('[data-test="rca-gate-state"]').exists()).toBe(true);
  });

  it("streams under the status card, and the door waits for the run to finish", async () => {
    const wrapper = mountPanel({ existingReport: "## Old" });
    analysis.current.refs.session.value = {
      sid: "rca1",
      turn: { state: "responding.writing" },
      turnMeta: { startedAt: 1, ownedByThisTab: true },
    };
    analysis.current.refs.answer.value = { role: "assistant", content: "## New" };
    await flushPromises();
    expect(wrapper.find('[data-test="rca-turn-status"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="trigger-rca-btn"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="rca-report"]').attributes("aria-busy")).toBe("true");
    expect(
      wrapper.get('[data-test="ai-entry-incident-report-ask"]').attributes("data-reason"),
    ).toBe("Available when the analysis finishes");
  });

  it("keeps a stopped run's findings and offers a fresh or a building run", async () => {
    const wrapper = mountPanel({ existingReport: "## Old" });
    analysis.current.refs.session.value = {
      sid: "rca1",
      turn: { state: "stopped", steps: 0, partial: true },
      turnMeta: { startedAt: 1_000, ownedByThisTab: true },
    };
    analysis.current.refs.answer.value = { role: "assistant", content: "## Partial" };
    await flushPromises();
    expect(wrapper.get('[data-test="rca-end-line"]').text()).toContain(
      "Findings so far are kept below.",
    );
    expect(wrapper.find('[data-test="rca-report"]').exists()).toBe(true);
    await wrapper.get('[data-test="rca-build-on-previous-btn"]').trigger("click");
    expect(analysis.current.analyze).toHaveBeenCalledWith({
      reanalysis: true,
      buildOnPrevious: true,
    });
  });

  it("shows a failure as the shared outcome card", async () => {
    const wrapper = mountPanel();
    analysis.current.refs.session.value = {
      sid: "rca1",
      turn: {
        state: "failed",
        error: { code: "unreachable", phase: "post_admission", retryable: true, action: "retry" },
      },
      turnMeta: { startedAt: 1, ownedByThisTab: true },
    };
    await flushPromises();
    expect(wrapper.find('[data-test="outcome"]').exists()).toBe(true);
  });

  it("shows a run another user or the automatic analysis started, with elapsed time and Stop", async () => {
    const wrapper = mountPanel({ serverRunStartedAt: Date.now() - 120_000 });
    await flushPromises();
    const card = wrapper.get('[data-test="rca-running-elsewhere"]');
    expect(card.text()).toContain("Analysing ·");
    expect(card.text()).toContain("Started");
    expect(wrapper.find('[data-test="trigger-rca-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="rca-stale"]').exists()).toBe(false);
    await wrapper.get('[data-test="rca-stop-btn"]').trigger("click");
    await flushPromises();
    expect(incidentsService.cancelRca).toHaveBeenCalledWith("default", "inc-1");
    expect(wrapper.get('[data-test="rca-end-line"]').text()).toContain("Stopped by you after");
  });

  it("warns when the other run looks stuck, and says so when Stop fails", async () => {
    vi.mocked(incidentsService.cancelRca).mockRejectedValueOnce(new Error("503"));
    const wrapper = mountPanel({ serverRunStartedAt: Date.now() - RCA_STALE_AFTER_MS - 60_000 });
    await flushPromises();
    expect(wrapper.get('[data-test="rca-stale"]').text()).toContain("It may have stopped.");
    await wrapper.get('[data-test="rca-stop-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-test="rca-stop-failed"]').text()).toContain(
      "Couldn't stop the analysis.",
    );
  });

  it("gives an analysis already in progress and a priority turned off their own states", async () => {
    const wrapper = mountPanel();
    analysis.current.refs.refusal.value = "running_elsewhere";
    await flushPromises();
    expect(wrapper.find('[data-test="rca-running-elsewhere"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rca-gate-state"]').exists()).toBe(false);
    analysis.current.refs.refusal.value = "priority_off";
    await flushPromises();
    expect(wrapper.get('[data-test="rca-priority-off"]').text()).toContain("priority");
    expect(wrapper.find('[data-test="rca-gate-state"]').exists()).toBe(false);
  });

  it("links a failure to the incident's logs in a new tab", async () => {
    const wrapper = mountPanel({
      window: { from: 1_000, to: 2_000 },
      logStreams: ["k8s_logs"],
    });
    analysis.current.refs.session.value = {
      sid: "rca1",
      turn: {
        state: "failed",
        error: { code: "unreachable", phase: "post_admission", retryable: true, action: "retry" },
      },
      turnMeta: { startedAt: 1, ownedByThisTab: true },
    };
    await flushPromises();
    const link = wrapper.get('[data-test="rca-open-logs"]');
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("href")).toContain("stream=k8s_logs");
    expect(link.attributes("href")).toContain("from=1000000");
  });

  it("offers a re-analysis after a severity change, and remembers a dismissal", async () => {
    const wrapper = mountPanel({ existingReport: "## Old", severityChange: "P1" });
    await flushPromises();
    expect(wrapper.get('[data-test="rca-rerun-chip"]').text()).toContain("Severity changed to P1");
    await wrapper.get('[data-test="rca-rerun-chip-accept"]').trigger("click");
    await flushPromises();
    expect(analysis.current.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ reanalysis: true }),
    );
    const again = mountPanel({ existingReport: "## Old", severityChange: "P2" });
    await again.get('[data-test="rca-rerun-chip-dismiss"]').trigger("click");
    expect(again.find('[data-test="rca-rerun-chip"]').exists()).toBe(false);
    expect(
      mountPanel({ existingReport: "## Old", severityChange: "P2" })
        .find('[data-test="rca-rerun-chip"]')
        .exists(),
    ).toBe(false);
  });

  it("lists earlier versions and opens one", async () => {
    const wrapper = mountPanel({
      existingReport: "## Now",
      history: [{ content: "## Before", archived_at: 1_700_000_000_000_000 }],
    });
    await flushPromises();
    expect(wrapper.get('[data-test="rca-history-btn"]').text()).toContain("Report 2");
  });
});
