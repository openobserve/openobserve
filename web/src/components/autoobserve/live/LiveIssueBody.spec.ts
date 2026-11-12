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
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import config from "@/aws-exports";
import { queryClient } from "@/composables/query/queryClient";
import incidents from "@/services/incidents";
import type { AutoObserveIncidentItem } from "@/services/autoobserve";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import LiveIssueBody from "./LiveIssueBody.vue";

const push = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ push, replace: vi.fn() }),
  useRoute: () => ({ query: {} }),
}));

vi.mock("@/services/incidents", async (importOriginal) => {
  const mod = await importOriginal<{ default: Record<string, unknown> }>();
  return { ...mod, default: { ...mod.default, get: vi.fn(), getEvents: vi.fn() } };
});

const api = vi.hoisted(() => ({ fetch: vi.fn(), cancel: vi.fn() }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...args: unknown[]) => api.fetch(...args),
    cancelStreamQueryBasedOnRequestId: (...args: unknown[]) => api.cancel(...args),
  }),
}));

const vol = vi.hoisted(() => ({ streams: vi.fn() }));
vi.mock("@/services/autoobserveVolume", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: { streams: (...args: unknown[]) => vol.streams(...args) },
}));

// The run composable reads a live stream; here only what it hands the tab matters.
const rcaState = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("@/composables/useIncidentRca", async () => {
  const { ref: vref, shallowRef: vshallow } = await import("vue");
  const make = () => ({
    runSummary: vshallow(rcaState.value?.runSummary ?? null),
    reportText: vref((rcaState.value?.reportText as string) ?? ""),
    reportVerdict: vshallow(rcaState.value?.reportVerdict ?? null),
    triggering: vref(false),
    live: vref(false),
    trigger: vi.fn(),
  });
  return { useIncidentRca: make, default: make };
});

type Handlers = {
  data: (p: unknown, r: unknown) => void;
  error: (p: unknown, r: unknown) => void;
  complete: (p: unknown, r: unknown) => void;
};
const calls = () => api.fetch.mock.calls as unknown as [unknown, Handlers][];

const NOW = Date.UTC(2026, 10, 10, 18, 0);
const T0 = Date.UTC(2026, 10, 10, 16, 45);
const US = T0 * 1000;
const MIN_US = 60_000_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);

const member = (name: string, offsetMin = 0, backMin: number | null = null) => ({
  id: `f-${name}`,
  title: `${name} (logs) stopped sending data`,
  stream_type: "logs",
  stream_name: name,
  first_seen_at: US + offsetMin * MIN_US,
  recovered_at: backMin === null ? null : US + backMin * MIN_US,
});

const item = (over: Partial<AutoObserveIncidentItem> = {}): AutoObserveIncidentItem => ({
  finding: {
    id: "f1",
    kind: "stream_silence",
    stream_type: "logs",
    stream_name: "pay_api",
    first_seen_at: US,
  },
  incident: {
    id: "inc-1",
    status: "open",
    severity: "P2",
    title: "pay_api (logs) stopped sending data",
    created_at: US + MIN_US,
  },
  investigation: { run_id: null, state: null, outcome: null, summary: null, not_run_reason: null },
  page: { outcome: "paged", team_id: "t1", team_name: "Payments" },
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  data: {
    id: "inc-1",
    org_id: "demo-org",
    status: "open",
    severity: "P2",
    group_values: {
      autoobserve_finding: "stream_silence",
      stream_type: "logs",
      stream_name: "pay_api",
    },
    first_alert_at: US,
    last_alert_at: US,
    alert_count: 1,
    created_at: US,
    updated_at: US,
    rca: null,
    alerts: [],
    triggers: [
      {
        incident_id: "inc-1",
        alert_id: "autoobserve:f1",
        alert_name: "pay_api (logs) stopped sending data",
        alert_kind: "autoobserve",
        alert_fired_at: US,
        correlation_reason: "alert_id",
        created_at: US,
      },
    ],
    ...over,
  },
});

const httpError = (status: number) => ({
  response: { status, data: { message: `status ${status}` } },
});

const get = vi.mocked(incidents.get);
const getEvents = vi.mocked(incidents.getEvents);
const originalOrg = store.state.selectedOrganization;
const originalConfig = store.state.zoConfig;
const originalEnterprise = config.isEnterprise;
let wrappers: ReturnType<typeof mount>[] = [];

const mountBody = async (it: AutoObserveIncidentItem = item(), initialTab = "overview") => {
  const w = mount(LiveIssueBody, {
    props: { item: it, initialTab: initialTab as never },
    attachTo: document.body,
    global: {
      plugins: [i18n, store],
      stubs: { IssueSignal: true, IncidentTimeline: true, IncidentAlertTriggersTable: true },
    },
  });
  wrappers.push(w);
  await flushPromises();
  return w;
};

const openTab = async (w: ReturnType<typeof mount>, tab: string) => {
  w.findComponent(OTabs).vm.$emit("update:modelValue", tab);
  await flushPromises();
};

const sel = (name: string) => `[data-test="${name}"]`;
const tabNames = (w: ReturnType<typeof mount>) =>
  w
    .findAll('[data-test^="autoobserve-issue-tab-"]')
    .map((tab) => tab.attributes("data-test")?.replace("autoobserve-issue-tab-", ""));

describe("LiveIssueBody", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    queryClient.clear();
    push.mockReset();
    api.fetch.mockReset();
    vol.streams.mockReset();
    vol.streams.mockRejectedValue(httpError(404));
    get.mockReset();
    getEvents.mockReset();
    get.mockResolvedValue(detail() as never);
    getEvents.mockResolvedValue({ data: { events: [] } } as never);
    rcaState.value = null;
    config.isEnterprise = "true";
    store.commit("setSelectedOrganization", { ...originalOrg, identifier: "demo-org" });
    store.commit("setConfig", { ...originalConfig, incidents_rca_enabled: false });
  });

  afterEach(() => {
    for (const w of wrappers) w.unmount();
    wrappers = [];
    vi.useRealTimers();
    config.isEnterprise = originalEnterprise;
    store.commit("setSelectedOrganization", originalOrg);
    store.commit("setConfig", originalConfig);
  });

  describe("tabs", () => {
    it("an AutoObserve incident gets Activity and a Logs link, and never the empty Metrics or Traces", async () => {
      const w = await mountBody();
      expect(tabNames(w)).toEqual(["overview", "analysis", "graph", "firings", "activity", "logs"]);
      expect(w.text()).not.toContain("Metrics");
      expect(w.text()).not.toContain("Traces");
    });

    it("a metrics finding has no rows to open in Logs, so it has no Logs tab", async () => {
      const metrics = item();
      metrics.finding.stream_type = "metrics";
      const w = await mountBody(metrics);
      expect(tabNames(w)).not.toContain("logs");
    });

    it("the Logs tab opens the stream in Logs from an hour before it started", async () => {
      const w = await mountBody(item(), "logs");
      expect(w.get(sel("autoobserve-issue-logs")).text()).toContain("See pay_api's rows in Logs");
      await w.get(sel("autoobserve-issue-logs-open")).trigger("click");
      const route = push.mock.calls[0][0] as { query: Record<string, string> };
      expect(route.query.stream).toBe("pay_api");
      expect(Number(route.query.from)).toBe(US - 3_600_000_000);
    });

    it("opening the drawer asks for the incident and its events once, and charts nothing extra", async () => {
      const w = await mountBody(item({ members: [member("pay_api"), member("b", 2)] }));
      expect(get).toHaveBeenCalledTimes(1);
      expect(getEvents).toHaveBeenCalledTimes(1);
      expect(api.fetch).not.toHaveBeenCalled();
      expect(vol.streams).not.toHaveBeenCalled();
      await openTab(w, "analysis");
      expect(api.fetch).toHaveBeenCalledTimes(2);
      expect(vol.streams).toHaveBeenCalledTimes(1);
      expect(vol.streams.mock.calls[0][1]).toEqual(["logs/pay_api", "logs/b"]);
      await openTab(w, "overview");
      await openTab(w, "analysis");
      expect(api.fetch).toHaveBeenCalledTimes(2);
      expect(vol.streams).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledTimes(1);
    });
  });

  describe("overview", () => {
    it("shows what happened and why there is no cause, what to check, the chart, who was paged and the affected streams", async () => {
      getEvents.mockResolvedValue({
        data: {
          events: [{ type: "Acknowledged", timestamp: US + 9 * MIN_US, data: { user_id: "ana" } }],
        },
      } as never);
      const w = await mountBody(item({ members: [member("pay_api"), member("b", 2, 30)] }));
      expect(w.get(sel("autoobserve-issue-rca")).text()).toContain("What happened");
      expect(w.get(sel("autoobserve-live-issue-no-cause")).text()).toContain("isn't turned on");
      expect(w.get(sel("autoobserve-live-issue-likely")).text()).toContain("shared collector");
      const chart = w.findComponent({ name: "IssueSignal" });
      expect(chart.props("stream")).toMatchObject({ name: "pay_api" });
      expect(chart.props("size")).toBe("card");
      expect(chart.props("endUs")).toBeNull();
      expect(w.get(sel("autoobserve-live-issue-page")).text()).toBe("Paged Payments");
      expect(w.get(sel("autoobserve-issue-timeline")).text()).toContain("Acknowledged");
      const blast = w
        .findAllComponents(OTag)
        .filter((c) => c.find(sel("autoobserve-live-issue-blast-stream")).exists());
      expect(blast.map((b) => [b.text(), b.props("variant")])).toEqual([
        ["pay_api", "error-soft"],
        ["b", "default-soft"],
      ]);
      expect(w.find('[role="meter"]').exists()).toBe(false);
      expect(w.get(sel("autoobserve-issue-chart-note")).text()).toBe(
        "Charting pay_api, the stream that opened this incident. How it unfolded charts the other one.",
      );
      expect(w.get(sel("autoobserve-issue-tab-overview")).attributes("autofocus")).toBeDefined();
      expect(w.get(sel("autoobserve-issue-tab-analysis")).attributes("autofocus")).toBeUndefined();
    });

    it("nobody paged is a warning and offers routing setup", async () => {
      const w = await mountBody(
        item({ page: { outcome: "unrouted", team_id: null, team_name: null } }),
      );
      expect(w.get(sel("autoobserve-live-issue-page")).attributes("data-tone")).toBe("warning");
      expect(w.find(sel("autoobserve-live-issue-routing")).exists()).toBe(true);
    });

    it("a failed events read keeps the engine's timeline and says the rest is missing", async () => {
      getEvents.mockRejectedValue(httpError(500));
      const w = await mountBody();
      await vi.waitFor(() =>
        expect(w.find(sel("autoobserve-live-issue-events-error")).exists()).toBe(true),
      );
      expect(w.get(sel("autoobserve-issue-timeline")).text()).toContain("AutoObserve noticed it");
    });
  });

  describe("analysis without AI", () => {
    it("shows the engine's verdict, healthy vs affected bars and the locked Analyze control with its reason", async () => {
      const w = await mountBody(item({ members: [member("pay_api"), member("b")] }), "analysis");
      expect(w.get(sel("autoobserve-analysis-verdict")).text()).toContain("pay_api");
      expect(w.find(sel("autoobserve-analysis-checked")).exists()).toBe(false);
      expect(w.get('[role="meter"]').attributes("aria-valuenow")).toBe("0");
      expect(w.find(sel("autoobserve-analysis-comparison-loading")).exists()).toBe(true);
      for (const call of calls()) {
        call[1].data(null, {
          type: "search_response_hits",
          content: { results: { hits: [{ t: iso(T0 - 900_000), n: 1200 }] } },
        });
        call[1].complete(null, {});
      }
      await flushPromises();
      const bars = w.get(sel("autoobserve-analysis-comparison")).text();
      expect(bars).toContain("pay_api, before");
      expect(bars).toContain("b, since it started");
      expect(w.find(sel("autoobserve-analysis-comparison-missing")).exists()).toBe(false);
      // Two streams that stopped together read as one step naming both.
      const trail = w.get(sel("autoobserve-analysis-trail")).text();
      expect(trail).toContain("pay_api and b · logs stream");
      expect(trail.match(/Stopped sending data/g)).toHaveLength(1);
      const button = w.get(sel("autoobserve-issue-analyze-btn"));
      expect(button.attributes("disabled")).toBeDefined();
      expect(w.get(sel("autoobserve-issue-analyze-reason")).text()).not.toMatch(/RCA/);
      expect(w.find(sel("autoobserve-analysis-copy")).exists()).toBe(false);
      expect(w.find(sel("autoobserve-analysis-report")).exists()).toBe(false);
    });

    it("a 400 on the volumes is a red failure whose Retry asks again", async () => {
      const w = await mountBody(item(), "analysis");
      calls()[0][1].error(null, { content: { status: 400 } });
      await flushPromises();
      const error = w.get(sel("autoobserve-analysis-comparison-error"));
      expect(error.find('[role="alert"]').exists()).toBe(true);
      await w.get(sel("autoobserve-analysis-comparison-retry")).trigger("click");
      await flushPromises();
      expect(calls()).toHaveLength(2);
    });

    it("a 403 on every volume names the stream it can't read and offers no Retry", async () => {
      const w = await mountBody(item(), "analysis");
      calls()[0][1].error(null, { content: { status: 403 } });
      await flushPromises();
      expect(w.get(sel("autoobserve-analysis-comparison-error")).text()).toContain("pay_api");
      expect(w.find(sel("autoobserve-analysis-comparison-retry")).exists()).toBe(false);
    });

    it.each([
      ["one stream's count", 500, 404, "b", 3, 1],
      ["the usual level", 200, 500, "usual level", 2, 2],
    ])(
      "a failed read of %s keeps the bars that loaded, says what is missing, and Retry asks only for it",
      async (_, countStatus, volumeStatus, named, searches, volumeReads) => {
        vol.streams.mockRejectedValue(httpError(volumeStatus));
        const w = await mountBody(item({ members: [member("pay_api"), member("b")] }), "analysis");
        calls()[0][1].complete(null, {});
        if (countStatus === 200) calls()[1][1].complete(null, {});
        else calls()[1][1].error(null, { content: { status: countStatus } });
        await flushPromises();
        expect(w.get(sel("autoobserve-analysis-comparison")).text()).toContain("pay_api");
        const missing = w.get(sel("autoobserve-analysis-comparison-missing"));
        expect(missing.attributes("role")).toBe("alert");
        expect(missing.text()).toContain(named);
        await w.get(sel("autoobserve-analysis-comparison-missing-retry")).trigger("click");
        await flushPromises();
        expect(calls()).toHaveLength(searches);
        expect(vol.streams).toHaveBeenCalledTimes(volumeReads);
      },
    );

    it("more streams than fit are compared up to the cap, then summed up", async () => {
      const many = item({
        members: [member("pay_api"), ...["a", "b", "c", "d", "e"].map((n, i) => member(n, i + 1))],
      });
      const w = await mountBody(many, "analysis");
      expect(calls()).toHaveLength(4);
      for (const call of calls()) call[1].complete(null, {});
      await flushPromises();
      expect(w.get(sel("autoobserve-analysis-comparison-more")).text()).toBe(
        "and 2 more streams not compared",
      );
    });
  });

  describe("analysis with AI", () => {
    it("renders the run's verdict, confidence meter and hypotheses, and no Analyze control", async () => {
      rcaState.value = {
        runSummary: {
          card: {
            headline: "A collector restart dropped pay_api's pipeline",
            band: "high",
            confidence: { evidence_reason: "1 decisive source (logs)" },
          },
          hypotheses: [
            {
              id: "h1",
              statement: "Collector restart",
              status: "root_cause",
              reason: "Restarted at 16:44",
            },
            {
              id: "h2",
              statement: "Traffic drop",
              status: "ruled_out",
              reason: "Traffic was flat",
            },
          ],
          evidence: [],
        },
        reportText: "# Report",
      };
      get.mockResolvedValue(
        detail({ rca: { run_id: "r1", state: "completed", confidence: "high" } }) as never,
      );
      const w = await mountBody(item(), "analysis");
      expect(w.get(sel("autoobserve-analysis-verdict")).text()).toContain(
        "A collector restart dropped",
      );
      expect(w.get('[role="meter"]').attributes("aria-valuenow")).toBe("3");
      expect(w.find(sel("autoobserve-analysis-hypothesis-confirmed")).text()).toContain(
        "Collector restart",
      );
      expect(w.find(sel("autoobserve-analysis-hypothesis-ruled_out")).exists()).toBe(true);
      expect(w.find(sel("autoobserve-issue-analyze")).exists()).toBe(false);
      expect(w.find(sel("autoobserve-analysis-report")).exists()).toBe(true);
    });
  });

  describe("a resolved incident", () => {
    const resolved = () =>
      item({
        incident: {
          id: "inc-1",
          status: "resolved",
          severity: "P2",
          title: "t",
          created_at: US + MIN_US,
        },
        members: [member("pay_api", 0, 10)],
      });

    it("opens Logs up to an hour after it ended and says so", async () => {
      const w = await mountBody(resolved(), "logs");
      expect(w.get(sel("autoobserve-issue-logs")).text()).toContain("an hour after it ended");
      await w.get(sel("autoobserve-issue-logs-open")).trigger("click");
      const route = push.mock.calls[0][0] as { query: Record<string, string> };
      expect(Number(route.query.to)).toBe((T0 + 10 * 60_000 + 3_600_000) * 1000);
    });
  });

  describe("how it unfolded", () => {
    it("draws a lane per stream and the team lane, and a card shows its stream's chart", async () => {
      const w = await mountBody(item({ members: [member("pay_api"), member("b", 2)] }), "graph");
      expect(w.find(sel("autoobserve-unfold-card-stream:logs/pay_api")).exists()).toBe(true);
      expect(w.find(sel("autoobserve-unfold-card-stream:logs/b")).exists()).toBe(true);
      expect(w.find(sel("autoobserve-unfold-card-page")).exists()).toBe(true);
      await w.get(sel("autoobserve-unfold-card-stream:logs/b")).trigger("click");
      const chart = w.findComponent({ name: "IssueSignal" });
      expect(chart.props("stream")).toMatchObject({ name: "b" });
      expect(chart.props("anchorUs")).toBe(US);
      expect(chart.props("size")).toBe("card");
      expect(w.find(sel("autoobserve-unfold-note")).exists()).toBe(false);
    });

    it("past the lane cap it says how many streams it left out and where they are", async () => {
      const members = Array.from({ length: 8 }, (_, i) => member(i ? `s${i}` : "pay_api"));
      const w = await mountBody(item({ members }), "graph");
      expect(w.findAll('[data-test^="autoobserve-unfold-card-stream:"]')).toHaveLength(6);
      expect(w.get(sel("autoobserve-unfold-note")).text()).toBe(
        "and 2 more streams not drawn; Blast radius on Overview lists them",
      );
    });
  });

  describe("alert triggers", () => {
    it("hands the triggers table the drawer's clock, AutoObserve's reason and no empty Labels column", async () => {
      get.mockResolvedValue(detail() as never);
      const w = await mountBody(item(), "firings");
      const table = w.findComponent({ name: "IncidentAlertTriggersTable" });
      expect(table.props("hideEmptyColumns")).toBe(true);
      expect(table.props("formatTime")(US)).toBe("4:45 PM");
      const reason = table.props("reasonLabel");
      expect(reason({ alert_kind: "autoobserve", correlation_reason: "alert_id" })).toBe(
        "Grouped by AutoObserve",
      );
      expect(reason({ alert_kind: "internal", correlation_reason: "alert_id" })).toBeNull();
      expect(reason({ alert_kind: "internal", correlation_reason: "service_discovery" })).toBe(
        "Service Discovery",
      );
    });

    it("names the server's account AutoObserve in Activity", async () => {
      const w = await mountBody(item(), "activity");
      const timeline = w.findComponent({ name: "IncidentTimeline" });
      expect(timeline.props("actorLabel")("system@openobserve.ai")).toBe("AutoObserve");
      expect(timeline.props("actorLabel")("ana")).toBe("ana");
      expect(timeline.props("formatTime")(US)).toBe("4:45 PM");
      expect(timeline.props("plainNames")).toBe(true);
    });

    it("lists the firings beside the finding details", async () => {
      const w = await mountBody(item(), "firings");
      expect(w.get(sel("autoobserve-issue-triggers-note")).text()).toBe("1 firing");
      expect(w.findComponent({ name: "IncidentAlertTriggersTable" }).exists()).toBe(true);
      expect(w.get(sel("incident-finding-started")).text()).toBe("4:45 PM");
      expect(w.get(sel("incident-finding-note")).text()).toContain("no alert rule to open");
    });

    it("a 404 on the incident is a red failure with Retry", async () => {
      get.mockRejectedValue(httpError(404));
      const w = await mountBody(item(), "firings");
      await vi.waitFor(() =>
        expect(w.find(sel("autoobserve-issue-triggers-error")).exists()).toBe(true),
      );
      expect(w.get(sel("autoobserve-issue-triggers-error")).attributes("role")).toBe("alert");
    });
  });
});
