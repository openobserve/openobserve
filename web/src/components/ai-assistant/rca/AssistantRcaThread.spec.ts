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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

const { resolveHref, relay } = vi.hoisted(() => ({
  resolveHref: vi.fn(() => ({
    href: "/web/incidents/inc-1?org_identifier=default&tab=incidentAnalysis",
  })),
  relay: vi.fn(),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn(), resolve: resolveHref }) }));
vi.mock("@/services/incidents", () => ({
  default: {
    get: vi.fn(),
    getRcaRun: vi.fn(),
    triggerRca: vi.fn(),
    resumeRca: vi.fn(),
    cancelRca: vi.fn(),
    steerRca: vi.fn(),
    openRcaLiveStream: vi.fn(),
  },
}));
vi.mock("@/composables/assistant", () => ({
  openAssistant: relay,
  legacyRelayArgs: (value: unknown) => ({ relayed: value }),
}));

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import incidentsService, {
  type IncidentWithAlerts,
  type RcaLiveEvent,
  type RcaSummary,
} from "@/services/incidents";
import AssistantRcaThread from "./AssistantRcaThread.vue";
import {
  RCA_T0,
  rcaRun,
  rcaRunItem,
  rcaRunSummary,
  rcaRunSummaryLive,
  rcaSteeringLive,
  rcaSummary,
  rcaThread,
  sec,
} from "@/test/unit/fixtures/rcaThread";

const service = vi.mocked(incidentsService);

// ODropdown renders its menu only when open; the stub renders every item.
const stubs = {
  ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: {
    props: { disabled: { type: Boolean, default: false } },
    emits: ["select"],
    template:
      "<div role='menuitem' :data-disabled='disabled' @click=\"!disabled && $emit('select')\"><slot /></div>",
  },
};

const incident = (rca: RcaSummary): IncidentWithAlerts =>
  ({
    id: "inc-1",
    org_id: "default",
    status: "open",
    severity: "P1",
    first_alert_at: RCA_T0,
    last_alert_at: RCA_T0,
    alert_count: 1,
    title: "checkout 5xx",
    created_at: RCA_T0,
    updated_at: RCA_T0,
    rca,
    alerts: [],
    triggers: [],
  }) as IncidentWithAlerts;

const COMPLETED = rcaSummary({
  run_id: "run-1",
  state: "completed",
  outcome: "root_cause_found",
  report_run: rcaRunItem(),
  history: [rcaRunItem()],
} as Partial<RcaSummary>);

const LIVE = rcaSummary({
  current_run: rcaRun(),
  history: [rcaRunItem({ run_id: "run-2", state: "running", ended_at: null }), rcaRunItem()],
} as Partial<RcaSummary>);

/** Feeds the live stream's parts as the server sends them, then keeps it open. */
const streamParts = (events: RcaLiveEvent[]): void => {
  service.openRcaLiveStream.mockImplementation((_org, _id, _run, { onEvent }) => {
    for (const event of events) onEvent(event);
    return new Promise(() => undefined);
  });
};

let wrapper: VueWrapper | undefined;
const mountThread = async (rca: RcaSummary, runId: string, sheet?: "half" | "full") => {
  service.get.mockResolvedValue({ data: incident(rca) } as never);
  wrapper = mount(AssistantRcaThread, {
    props: { org: "default", incidentId: "inc-1", runId, ...(sheet ? { sheet } : {}) },
    global: {
      plugins: [i18n, store, [VueQueryPlugin, { queryClient: new QueryClient() }]],
      stubs,
    },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

const byTest = (id: string) => wrapper!.find(`[data-test="${id}"]`);

describe("AssistantRcaThread (C5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.zoConfig.incidents_rca_enabled = true;
    service.getRcaRun.mockImplementation((_org, _id, runId) =>
      Promise.resolve({
        data: { run_id: runId, report: "## Root cause\n\nPool exhausted." },
      } as never),
    );
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  describe("a finished run", () => {
    beforeEach(() =>
      streamParts([
        {
          event: "thread",
          data: rcaThread({ run_id: "run-1", active: false, report_submitted: true }),
        },
        { event: "summary", data: rcaRunSummary({ run_id: "run-1", state: "completed" }) },
        { event: "steering", data: rcaSteeringLive({ can_steer: true }) },
      ]),
    );

    it("takes no messages: no composer, no Disprove/Reopen/Test first", async () => {
      await mountThread(COMPLETED, "run-1");

      expect(byTest("assistant-rca-thread-title").text()).toBe("checkout 5xx · Incident analysis");
      expect(byTest("rca-steer-composer").exists()).toBe(false);
      expect(wrapper!.find("textarea").exists()).toBe(false);
      expect(wrapper!.findAll('[data-test^="rca-hypothesis-action-"]')).toHaveLength(0);
    });

    it("ends with the shipped closed line and exactly one Re-analyze", async () => {
      await mountThread(COMPLETED, "run-1");

      expect(byTest("rca-thread-final-text").text()).toBe(
        "This run no longer takes messages. Re-analyze to start a new version.",
      );
      const reanalyze = wrapper!
        .findAll("button")
        .filter((button) => button.text().startsWith("Re-analyze"));
      expect(reanalyze).toHaveLength(1);
      const all = wrapper!.findAll("[data-test]").map((el) => el.attributes("data-test"));
      expect(all.at(-1)).toBe("rca-thread-reanalyze");
    });

    it("folds its activity into one line", async () => {
      await mountThread(COMPLETED, "run-1");

      expect(byTest("rca-thread-activity-toggle").exists()).toBe(true);
      expect(byTest("rca-thread-entries").exists()).toBe(false);
    });

    it("offers the answer row: copy, share, branch and Markdown, and no Cancel", async () => {
      await mountThread(COMPLETED, "run-1");

      expect(byTest("assistant-rca-thread-actions").exists()).toBe(true);
      expect(byTest("assistant-rca-thread-export").text()).toBe("Download as Markdown");
      expect(byTest("rca-cancel-btn").exists()).toBe(false);
    });

    it("Share link copies the incident's analysis link and says so in place", async () => {
      const writeText = vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);
      await mountThread(COMPLETED, "run-1");

      await byTest("assistant-rca-thread-share").trigger("click");
      await flushPromises();
      expect(resolveHref).toHaveBeenCalledWith({
        name: "incidentDetail",
        params: { id: "inc-1" },
        query: { org_identifier: "default", tab: "incidentAnalysis" },
      });
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/web/incidents/inc-1?org_identifier=default&tab=incidentAnalysis`,
      );
      expect(byTest("assistant-rca-thread-share").text()).toBe("Link copied");
    });
  });

  describe("a live run", () => {
    beforeEach(() =>
      streamParts([
        { event: "thread", data: rcaThread({ run_id: "run-2" }) },
        { event: "summary", data: rcaRunSummaryLive({ run_id: "run-2" }) },
        { event: "steering", data: rcaSteeringLive({ can_steer: true }) },
      ]),
    );

    it("keeps the steer box and puts Cancel run behind ⋯ with a confirm", async () => {
      await mountThread(LIVE, "run-2");

      expect(byTest("rca-steer-composer").exists()).toBe(true);
      expect(byTest("rca-thread-final-note").exists()).toBe(false);
      await byTest("rca-cancel-btn").trigger("click");
      expect(service.cancelRca).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("Cancel run?");
    });
  });

  it("Re-analyze follows the new run and names it to the host, never snapping back to the old one", async () => {
    streamParts([]);
    await mountThread(COMPLETED, "run-1");
    service.triggerRca.mockResolvedValue({ data: { run_id: "run-2" } } as never);
    service.get.mockResolvedValue({ data: incident(LIVE) } as never);

    wrapper!
      .findComponent({ name: "IncidentRCAAnalysis" })
      .vm.$emit("trigger-rca", { buildOnPrevious: true });
    await flushPromises();

    expect(wrapper!.emitted("reanalyze")).toEqual([[{ runId: "run-2" }]]);
    // The host follows the named run, as AssistantSidebarHost does by re-keying the thread.
    await wrapper!.setProps({ runId: "run-2" });
    await flushPromises();
    expect(byTest("rca-thread-final-note").exists()).toBe(false);
  });

  it("as a phone sheet snaps between half and full", async () => {
    streamParts([]);
    await mountThread(COMPLETED, "run-1", "half");

    const root = byTest("assistant-rca-thread");
    expect(root.attributes("data-snap")).toBe("half");
    await byTest("assistant-rca-thread-snap").trigger("click");
    expect(root.attributes("data-snap")).toBe("full");
  });

  it("close emits close", async () => {
    streamParts([]);
    await mountThread(COMPLETED, "run-1");

    await byTest("assistant-rca-thread-close").trigger("click");
    expect(wrapper!.emitted("close")).toEqual([[]]);
  });

  it("an incident that cannot be read offers Retry", async () => {
    service.get.mockRejectedValue(new Error("boom"));
    wrapper = mount(AssistantRcaThread, {
      props: { org: "default", incidentId: "inc-1", runId: "run-1" },
      global: {
        plugins: [
          i18n,
          store,
          [
            VueQueryPlugin,
            { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          ],
        ],
        stubs,
      },
    });
    await flushPromises();

    expect(byTest("assistant-rca-thread-error").exists()).toBe(true);
    expect(sec(1)).toBeGreaterThan(0);
  });
});
