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
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OverviewNowRow, OverviewNowSnapshot } from "@/composables/contextProviders/types";
import { homeReturnFor } from "@/composables/goto/homeReturn";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { raw } from "@/types/i18n";

import { followedRcaRun, stopFollowingRca } from "@/components/ai-assistant/shell/rcaFollow";
import type { OrgRcaRun } from "@/services/rca_runs_org";

import HomeNowList from "./HomeNowList.vue";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  store: {
    state: { userOrgKey: "k1", sessions: {} as Record<string, { turn: unknown }> },
    open: vi.fn(),
  },
  triggerRca: vi.fn(),
  creditMode: { value: null as string | null },
  gate: { value: "available" },
  runs: { active: 0, cap: 3 },
}));

vi.mock("@/composables/assistant", async () => {
  const { computed, reactive } = await import("vue");
  mocks.store.state = reactive(mocks.store.state);
  return {
    openAssistant: mocks.open,
    contextChipFor: (field: string, id: string) => ({ id: `${field}:${id}`, kind: "incident" }),
    useAssistantCapability: () =>
      computed(() => ({ creditMode: mocks.creditMode.value, gate: mocks.gate.value })),
    useAssistantRuns: () => ({
      active: computed(() => mocks.runs.active),
      cap: computed(() => mocks.runs.cap),
    }),
    useAssistantStore: () => mocks.store,
  };
});
vi.mock("@/services/incidents", () => ({ default: { triggerRca: mocks.triggerRca } }));
vi.mock("./HomeCreditsLine.vue", () => ({
  default: { name: "CreditsLine", template: '<div data-test="credits-line-stub" />' },
}));

const incident: OverviewNowRow = {
  kind: "incident",
  key: "incident:inc-7",
  id: "inc-7",
  bucket: "critical",
  changedAt: 1_762_300_000_000_000,
  title: "Checkout errors",
  severity: "P1",
  status: "open",
  alertCount: 3,
};

const RUN: OrgRcaRun = {
  run_id: "run-1",
  incident_id: "inc-7",
  incident_title: "Checkout errors",
  severity: "P1",
  state: "completed",
  trigger: "auto",
  started_at: 1_762_299_000_000_000,
  ended_at: 1_762_299_400_000_000,
  error_code: null,
};

const snapshot = (rows: OverviewNowRow[] = [incident]): OverviewNowSnapshot => ({
  rows,
  selectedKey: null,
  window: { start: 1_762_296_400_000_000, end: 1_762_300_000_000_000 },
  services: {
    available: true,
    partial: false,
    dataUntil: Date.UTC(2026, 10, 5, 9, 40) * 1000,
    window: null,
    allRegions: true,
  },
  noData: false,
});

const mountList = (props: Record<string, unknown> = {}) =>
  mount(HomeNowList, {
    props: {
      snapshot: snapshot(),
      org: "acme",
      timezone: "UTC",
      trend: null,
      pending: false,
      failedSources: [],
      sources: ["incidents"],
      moreDegraded: 0,
      returnState: { period: "1h" },
      ...props,
    } as never,
    global: { plugins: [i18n, store] },
  });

describe("HomeNowList", () => {
  beforeEach(() => {
    mocks.open.mockReset().mockResolvedValue({ ok: true, sid: "s1" });
    mocks.creditMode.value = null;
    mocks.gate.value = "available";
    mocks.runs.active = 0;
    mocks.store.open.mockReset();
    mocks.triggerRca.mockReset();
    stopFollowingRca();
    for (const sid of Object.keys(mocks.store.state.sessions))
      delete mocks.store.state.sessions[sid];
  });

  it("titles the list Needs you with the services stamp and all regions combined", () => {
    const wrapper = mountList();
    expect(wrapper.get("h2").text()).toBe("Needs you");
    expect(wrapper.get('[data-test="home-now-services-until"]').text()).toBe(
      "Services data to 09:40",
    );
    expect(wrapper.find('[data-test="home-now-all-regions"]').exists()).toBe(true);
  });

  it("hands a row to a new sidebar chat, selects it and arms the way back", async () => {
    const wrapper = mountList();
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("select")).toEqual([[incident]]);
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ objectKind: "incident", container: "sidebar", thread: "new" }),
    );
    expect(homeReturnFor("s1" as never)).toEqual({ period: "1h", row: "incident:inc-7" });
  });

  it("does not send at the run cap and says how many chats run", async () => {
    mocks.runs.active = 3;
    const wrapper = mountList();
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="home-now-row-note"]').text()).toContain(
      "Not sent: 3 chats running",
    );
  });

  it("reads Open incident with credits used up, opens it, and shows the credits line", async () => {
    mocks.creditMode.value = "exhausted";
    const wrapper = mountList();
    expect(wrapper.find('[data-test="credits-line-stub"]').exists()).toBe(true);
    const button = wrapper.get('[data-test="home-now-row-investigate"]');
    expect(button.text()).toBe("Open incident");
    expect(wrapper.find('[data-test="home-now-row-open"]').exists()).toBe(false);
    await button.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("fallback")).toEqual([[incident]]);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("names the page a row opens when the assistant cannot chat", async () => {
    mocks.gate.value = "off_for_org";
    const alert: OverviewNowRow = {
      kind: "alert",
      key: "alert:a1",
      id: "a1",
      bucket: "degraded",
      changedAt: 0,
      alertId: "a1",
      name: "p99 high",
      state: "firing",
      count: 1,
      lastAt: 0,
    };
    const wrapper = mountList({ snapshot: snapshot([incident, alert]) });
    const labels = wrapper
      .findAll('[data-test="home-now-row-investigate"]')
      .map((button) => button.text());
    expect(labels).toEqual(["Open incident", "Open alert"]);
    await wrapper.findAll('[data-test="home-now-row-investigate"]')[1].trigger("click");
    expect(wrapper.emitted("fallback")).toEqual([[alert]]);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("opens the incident's analysis once its Investigate was sent", async () => {
    const wrapper = mountList();
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("analysis")).toEqual([[incident]]);
  });

  it("lists Problems with no alert under their own title, with Create alert for an editor", async () => {
    const service: OverviewNowRow = {
      kind: "service",
      key: "service:checkout",
      id: "checkout",
      bucket: "degraded",
      changedAt: 0,
      service: "checkout",
      errorRate: 6,
      requests: 100,
      p99Ms: null,
      p99Ratio: null,
      baselineErrorRate: 0.4,
      baselineHours: 24,
      signal: "errors",
      coverage: "none",
      partial: false,
    };
    const wrapper = mountList({
      snapshot: snapshot([service]),
      variant: "problems",
      createAlert: { enabled: true },
    });
    expect(wrapper.get("h2").text()).toBe("Problems with no alert");
    expect(wrapper.get('[data-test="home-now-row-no-alert"]').text()).toBe(
      "No alert matches this service",
    );
    expect(wrapper.find('[data-test="overview-built-from"]').exists()).toBe(false);
    await wrapper.get('[data-test="home-now-row-create-alert"]').trigger("click");
    expect(wrapper.emitted("createAlert")).toEqual([[service]]);
    const viewer = mountList({
      snapshot: snapshot([service]),
      variant: "problems",
      createAlert: { enabled: false },
    });
    const create = viewer.get('[data-test="home-now-row-create-alert"]');
    expect(create.attributes("aria-disabled")).toBe("true");
    await create.trigger("click");
    expect(viewer.emitted("createAlert")).toBeUndefined();
  });

  it("keeps one Retry row per failed source and says when nothing needs attention", async () => {
    const failed = mountList({
      snapshot: snapshot([]),
      failedSources: [{ key: "incidents", label: raw("Incidents") }],
    });
    expect(failed.get('[data-test="home-now-source-error-incidents"]').text()).toContain(
      "Incidents couldn't load",
    );
    await failed.get('[data-test="home-now-source-error-incidents-retry"]').trigger("click");
    expect(failed.emitted("retry")).toHaveLength(1);
    expect(failed.find('[data-test="home-now-clear"]').exists()).toBe(false);
    const clear = mountList({ snapshot: snapshot([]) });
    expect(clear.get('[data-test="home-now-clear"]').text()).toBe("Nothing needs attention");
  });

  it("notes a server run-cap refusal on the row whose chat the door accepted", async () => {
    const wrapper = mountList();
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="home-now-row-note"]').exists()).toBe(false);
    mocks.store.state.sessions.s1 = { turn: { state: "connecting" } };
    await flushPromises();
    mocks.store.state.sessions.s1.turn = {
      state: "refused",
      error: { code: "run_limit_member", active: 4, limit: 4 },
    };
    await flushPromises();
    expect(wrapper.get('[data-test="home-now-row-note"]').text()).toContain(
      "Not sent: 4 chats running",
    );
    expect(wrapper.find('[data-test="home-now-row-show-runs"]').exists()).toBe(true);
  });

  it("leaves no note when the accepted chat ends any other way", async () => {
    const wrapper = mountList();
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    mocks.store.state.sessions.s1 = { turn: { state: "done", saved: "server" } };
    await flushPromises();
    expect(wrapper.find('[data-test="home-now-row-note"]').exists()).toBe(false);
  });

  it("clears row notes when the range changes, and keeps them on a refresh of the same range", async () => {
    mocks.runs.active = 3;
    const wrapper = mountList();
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    await wrapper.setProps({ snapshot: { ...snapshot(), window: { start: 1, end: 2 } } } as never);
    expect(wrapper.find('[data-test="home-now-row-note"]').exists()).toBe(true);
    await wrapper.setProps({ returnState: { period: "6h" } } as never);
    expect(wrapper.find('[data-test="home-now-row-note"]').exists()).toBe(false);
  });

  it("keeps a row's note and refusal watch across a row selection, and drops both on a range change", async () => {
    const other: OverviewNowRow = { ...incident, key: "incident:inc-8", id: "inc-8" };
    const refused = () => ({
      turn: { state: "refused", error: { code: "run_limit_member", active: 4, limit: 4 } },
    });
    mocks.open
      .mockResolvedValueOnce({ ok: true, sid: "s1" })
      .mockResolvedValueOnce({ ok: true, sid: "s2" });
    const wrapper = mountList({ snapshot: snapshot([incident, other]) });
    await wrapper.findAll('[data-test="home-now-row-investigate"]')[0].trigger("click");
    await flushPromises();
    await wrapper.findAll('[data-test="home-now-row-investigate"]')[1].trigger("click");
    await flushPromises();
    mocks.store.state.sessions.s2 = refused();
    await flushPromises();
    const notes = () => wrapper.findAll('[data-test="home-now-row-note"]');
    expect(notes()).toHaveLength(1);
    await wrapper.setProps({ returnState: { period: "1h", row: other.key } } as never);
    expect(notes()).toHaveLength(1);
    mocks.store.state.sessions.s1 = refused();
    await flushPromises();
    expect(notes()).toHaveLength(2);
    await wrapper.setProps({ returnState: { period: "6h", row: other.key } } as never);
    expect(notes()).toHaveLength(0);
  });

  it("stops a pending refusal watch on a range change", async () => {
    const wrapper = mountList();
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    await wrapper.setProps({ returnState: { period: "6h" } } as never);
    mocks.store.state.sessions.s1 = {
      turn: { state: "refused", error: { code: "run_limit_member", active: 4, limit: 4 } },
    };
    await flushPromises();
    expect(wrapper.find('[data-test="home-now-row-note"]').exists()).toBe(false);
  });

  it("keeps each row busy until its own Investigate settles", async () => {
    const other: OverviewNowRow = { ...incident, key: "incident:inc-8", id: "inc-8" };
    const pending: Array<(v: unknown) => void> = [];
    mocks.open.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const wrapper = mountList({ snapshot: snapshot([incident, other]) });
    const buttons = wrapper.findAll('[data-test="home-now-row-investigate"]');
    await buttons[0].trigger("click");
    await buttons[1].trigger("click");
    await flushPromises();
    pending[1]({ ok: true, sid: "s2" });
    await flushPromises();
    const rows = wrapper.findAllComponents({ name: "HomeNowRow" });
    expect(rows.map((r) => r.props("busy"))).toEqual([true, false]);
    pending[0]({ ok: true, sid: "s1" });
    await flushPromises();
    expect(rows.map((r) => r.props("busy"))).toEqual([false, false]);
  });

  it("names a denied source and never says nothing needs attention beside it", () => {
    const wrapper = mountList({
      snapshot: snapshot([]),
      deniedSources: [{ key: "incidents", label: raw("Incidents") }],
    });
    expect(wrapper.get('[data-test="home-now-source-denied-incidents"]').text()).toBe(
      "IncidentsNo access",
    );
    expect(wrapper.find('[data-test="home-now-clear"]').exists()).toBe(false);
  });

  it("shows the partial and the 7-day notes", () => {
    const wrapper = mountList({
      snapshot: { ...snapshot(), services: { ...snapshot().services, partial: true } },
      trend: { warnings: ["region eu1 truncated"] },
      trendCapped: true,
    });
    expect(wrapper.get('[data-test="home-now-partial"]').text()).toContain(
      "Service figures may be incomplete",
    );
    expect(wrapper.get('[data-test="home-now-partial"]').text()).toContain("region eu1 truncated");
    expect(wrapper.find('[data-test="home-now-trend-cap"]').exists()).toBe(true);
  });

  it("shows skeleton rows on the first load", () => {
    expect(mountList({ pending: true }).find('[data-test="home-now-loading"]').exists()).toBe(true);
  });

  it("follows an incident's run in the side panel instead of starting another", async () => {
    const wrapper = mountList({ incidentRuns: new Map([["inc-7", RUN]]) });
    expect(wrapper.find('[data-test="home-now-row-investigate"]').exists()).toBe(false);
    await wrapper.get('[data-test="home-now-row-follow"]').trigger("click");
    expect(followedRcaRun().value).toEqual({ org: "acme", incidentId: "inc-7", runId: "run-1" });
    expect(mocks.store.open).toHaveBeenCalledWith(
      { kind: "sidebar" },
      expect.objectContaining({ focus: "none" }),
    );
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.triggerRca).not.toHaveBeenCalled();
  });

  it("starts an incident's run with the existing request when none exists, and follows it", async () => {
    mocks.triggerRca.mockResolvedValue({ data: { message: "started", run_id: "run-9" } });
    const wrapper = mountList({ incidentRuns: new Map() });
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    expect(mocks.triggerRca).toHaveBeenCalledWith("acme", "inc-7");
    expect(followedRcaRun().value).toEqual({ org: "acme", incidentId: "inc-7", runId: "run-9" });
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("asks in a chat when the run cannot start", async () => {
    mocks.triggerRca.mockRejectedValue(Object.assign(new Error("403"), { status: 403 }));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wrapper = mountList({ incidentRuns: new Map() });
    await wrapper.get('[data-test="home-now-row-investigate"]').trigger("click");
    await flushPromises();
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(followedRcaRun().value).toBeNull();
    error.mockRestore();
  });

  it("lists a failed auto-run as its own row with Retry and Open incident", async () => {
    mocks.triggerRca.mockResolvedValue({ data: { message: "started", run_id: "run-10" } });
    const failed: OrgRcaRun = {
      ...RUN,
      run_id: "run-2",
      incident_id: "inc-481",
      incident_title: "Payments timeouts",
      state: "failed",
      error_code: "query_timeout",
    };
    const wrapper = mountList({ snapshot: snapshot([]), failedRuns: [failed] });
    expect(wrapper.find('[data-test="home-now-clear"]').exists()).toBe(false);
    const row = wrapper.get('[data-test="home-failed-run"]');
    expect(row.text()).toContain("Payments timeouts");
    expect(row.get('[data-test="home-failed-run-state"]').text()).toBe("Failed");
    await row.get('[data-test="home-failed-run-open"]').trigger("click");
    expect(wrapper.emitted("openIncident")).toEqual([["inc-481"]]);
    await row.get('[data-test="home-failed-run-retry"]').trigger("click");
    await flushPromises();
    expect(mocks.triggerRca).toHaveBeenCalledWith("acme", "inc-481");
    expect(followedRcaRun().value?.runId).toBe("run-10");
  });
});
