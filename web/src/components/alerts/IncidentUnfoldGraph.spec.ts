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
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import alerts from "@/services/alerts";
import incidents from "@/services/incidents";
import type { IncidentAlert, IncidentWithAlerts } from "@/services/incidents";
import { makeAlertSectionRouter } from "@/test/unit/helpers/alertSectionRouter";
import IncidentUnfoldGraph from "./IncidentUnfoldGraph.vue";
import IncidentAlertPanel from "./IncidentAlertPanel.vue";
import AutoObserveUnfoldGraph from "@/components/autoobserve/AutoObserveUnfoldGraph.vue";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/services/incidents", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});

const listAlerts = vi.fn();
const getEvents = vi.fn();

// The shared clock reads the time when its first view mounts, so each test unmounts its graph.
enableAutoUnmount(afterEach);

const T0 = Date.UTC(2026, 10, 11, 15, 15, 0) * 1000;
const min = (m: number) => T0 + m * 60_000_000;

const firing = (alertId: string, at: number): IncidentAlert => ({
  incident_id: "inc",
  alert_id: alertId,
  alert_name: `${alertId}_alert`,
  alert_fired_at: at,
  correlation_reason: "service_discovery",
  created_at: at,
});

const incident = (triggers: IncidentAlert[], over: Partial<IncidentWithAlerts> = {}) =>
  ({
    id: "inc",
    org_id: "default",
    status: "open",
    severity: "P2",
    first_alert_at: triggers[0]?.alert_fired_at ?? T0,
    last_alert_at: triggers[triggers.length - 1]?.alert_fired_at ?? T0,
    alert_count: triggers.length,
    created_at: T0,
    updated_at: T0,
    rca: null,
    alerts: [],
    triggers,
    ...over,
  }) as IncidentWithAlerts;

const mountGraph = (value: IncidentWithAlerts, timezone = "UTC") =>
  mount(IncidentUnfoldGraph, {
    props: { incident: value },
    global: {
      plugins: [
        i18n,
        makeAlertSectionRouter(),
        createStore({ state: { timezone, selectedOrganization: { identifier: "acme" } } }),
      ],
      stubs: { IncidentAlertPanel: true },
    },
  });

const panelName = (wrapper: ReturnType<typeof mountGraph>) => {
  const panel = wrapper.findComponent(IncidentAlertPanel);
  return panel.props("open") ? (panel.props("summary")?.name ?? null) : null;
};

describe("IncidentUnfoldGraph", () => {
  beforeEach(() => {
    listAlerts.mockReset().mockResolvedValue({ data: { list: [] } });
    getEvents.mockReset().mockResolvedValue({ data: { events: [] } });
    Object.assign(alerts as object, { listByFolderId: listAlerts });
    Object.assign(incidents as object, { getEvents });
  });
  afterEach(() => vi.useRealTimers());

  it("shows an empty state when no alert fired into the incident", () => {
    const wrapper = mountGraph(incident([]));
    expect(wrapper.find('[data-test="incident-unfold-empty"]').exists()).toBe(true);
    expect(wrapper.findComponent(AutoObserveUnfoldGraph).exists()).toBe(false);
  });

  it("summarises the firings and renders one card per alert, plus your team", () => {
    vi.useFakeTimers();
    vi.setSystemTime(min(30) / 1000);
    const wrapper = mountGraph(
      incident([firing("a", min(0)), firing("b", min(20)), firing("b", min(25))]),
    );
    expect(wrapper.get('[data-test="incident-unfold-summary"]').text()).toMatch(
      /\b3\b.*\b2\b.*\b25\b/,
    );
    const graph = wrapper.findComponent(AutoObserveUnfoldGraph);
    expect(graph.props("cards").map((c) => c.id)).toEqual(["alert-a", "alert-b", "team-open"]);
  });

  it("reads the app's time zone, names it once, and dates each card time that is not today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(min(30) / 1000);
    const today = mountGraph(incident([firing("a", min(0))]), "Asia/Kolkata");
    expect(today.get('[data-test="autoobserve-unfold-card-alert-a"]').text()).toContain("20:45");
    expect(today.text().match(/GMT\+5:30/g)).toHaveLength(1);
    today.unmount();
    vi.setSystemTime(min(24 * 60) / 1000);
    const yesterday = mountGraph(incident([firing("a", min(0)), firing("b", min(5))]));
    expect(yesterday.get('[data-test="autoobserve-unfold-card-alert-a"]').text()).toContain(
      "Nov 11, 15:15",
    );
  });

  it("steps the lanes beside the open panel once more than 3 alerts fired", async () => {
    const step = async (count: number) => {
      const ids = ["a", "b", "c", "d"].slice(0, count);
      const wrapper = mountGraph(incident(ids.map((id, i) => firing(id, min(i * 10)))));
      const graph = () => wrapper.findComponent(AutoObserveUnfoldGraph).props("step");
      const closed = graph();
      await wrapper.get('[data-test="autoobserve-unfold-card-alert-a"]').trigger("click");
      const open = graph();
      wrapper.unmount();
      return [closed, open];
    };
    expect(await step(3)).toEqual([undefined, undefined]);
    expect(await step(4)).toEqual([undefined, 5.25]);
  });

  it("opens the alert's side panel from its card, and closes it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(min(30) / 1000);
    const wrapper = mountGraph(incident([firing("a", min(0)), firing("b", min(20))]));
    expect(panelName(wrapper)).toBeNull();
    await wrapper.get('[data-test="autoobserve-unfold-card-alert-b"]').trigger("click");
    expect(panelName(wrapper)).toBe("b_alert");
    expect(wrapper.find('[data-test="autoobserve-unfold-detail"]').exists()).toBe(false);
    wrapper.findComponent(IncidentAlertPanel).vm.$emit("close");
    await wrapper.vm.$nextTick();
    expect(panelName(wrapper)).toBeNull();
    // The closing panel keeps its alert, so it never slides out blank.
    expect(wrapper.findComponent(IncidentAlertPanel).props("summary")?.name).toBe("b_alert");
    expect(
      wrapper.get('[data-test="autoobserve-unfold-card-alert-b"]').attributes("aria-pressed"),
    ).toBe("false");
  });

  it("keeps the detail card for your team's cards", async () => {
    const wrapper = mountGraph(incident([firing("a", min(0))]));
    await wrapper.get('[data-test="autoobserve-unfold-card-team-open"]').trigger("click");
    expect(panelName(wrapper)).toBeNull();
    expect(wrapper.find('[data-test="autoobserve-unfold-detail"]').exists()).toBe(true);
  });

  it("dots each card with its alert's state from the alert list", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(min(30) / 1000);
    listAlerts.mockResolvedValue({
      data: {
        list: [
          {
            alert_id: "a",
            enabled: true,
            last_satisfied_at: min(25),
            trigger_condition: { frequency: 5, silence: 0 },
          },
        ],
      },
    });
    const wrapper = mountGraph(incident([firing("a", min(0)), firing("b", min(2))]));
    await flushPromises();
    const cards = wrapper.findComponent(AutoObserveUnfoldGraph).props("cards");
    expect(cards.find((c) => c.id === "alert-a")?.live?.firing).toBe(true);
    expect(wrapper.find('[data-test="autoobserve-unfold-live-alert-a"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="autoobserve-unfold-live-alert-b"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve-unfold-legend-firing"]').exists()).toBe(true);
  });

  it("names who acknowledged from the incident's events", async () => {
    getEvents.mockResolvedValue({
      data: {
        events: [{ timestamp: min(3), type: "Acknowledged", data: { user_id: "sam@example.com" } }],
      },
    });
    const wrapper = mountGraph(incident([firing("a", min(0))], { acknowledged_at: min(3) }));
    await flushPromises();
    expect(wrapper.get('[data-test="autoobserve-unfold-card-team-acknowledged"]').text()).toContain(
      "sam",
    );
  });

  it("keeps the selected card when the minute tick rebuilds the cards", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(min(30) / 1000);
    const wrapper = mountGraph(
      incident([firing("a", min(0)), firing("b", min(20)), firing("b", min(25))]),
    );
    await wrapper.get('[data-test="autoobserve-unfold-card-alert-b"]').trigger("click");
    vi.advanceTimersByTime(60_000);
    await wrapper.vm.$nextTick();
    expect(panelName(wrapper)).toBe("b_alert");
  });

  it("shows no live state on a resolved incident's cards, and still ticks the clock for the panel", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(min(30) / 1000);
    listAlerts.mockResolvedValue({
      data: { list: [{ alert_id: "a", last_satisfied_at: min(29), last_outcome: "error" }] },
    });
    const wrapper = mountGraph(
      incident([firing("a", min(0))], { status: "resolved", resolved_at: min(5) }),
    );
    await flushPromises();
    expect(wrapper.find('[data-test^="autoobserve-unfold-live-"]').exists()).toBe(false);
    const now = () => wrapper.findComponent(IncidentAlertPanel).props("now");
    const before = now();
    vi.advanceTimersByTime(6 * 60_000);
    await wrapper.vm.$nextTick();
    expect(now()).toBeGreaterThan(before);
  });

  it("lists in the legend only what the graph shows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(min(30) / 1000);
    const legendKeys = (wrapper: ReturnType<typeof mountGraph>) =>
      wrapper
        .findAll('[data-test^="autoobserve-unfold-legend-"]')
        .map((li) => li.attributes("data-test")!.replace("autoobserve-unfold-legend-", ""));
    const quiet = mountGraph(
      incident([firing("a", min(0)), firing("b", min(2))], {
        status: "resolved",
        resolved_at: min(10),
      }),
    );
    expect(legendKeys(quiet)).toEqual(["alert", "resolved", "after"]);
    quiet.unmount();
    expect(legendKeys(mountGraph(incident([firing("a", min(0))])))).toEqual(["alert", "team"]);

    const topology = {
      nodes: ["a", "b"].map((id) => ({
        alert_id: id,
        alert_name: `${id}_alert`,
        service_name: id === "a" ? "db" : "api",
        alert_count: 1,
        first_fired_at: min(0),
        last_fired_at: min(0),
      })),
      edges: [{ from_node_index: 0, to_node_index: 1, edge_type: "service_dependency" as const }],
      related_incident_ids: [],
    };
    const busy = mountGraph(
      incident([firing("a", min(0)), firing("b", min(20)), firing("b", min(25))], {
        topology_context: topology,
      }),
    );
    expect(legendKeys(busy)).toEqual(["alert", "team", "dependency"]);
  });

  it("unfolds a lane from its fold card, keeping the selection on the lane's alerts", async () => {
    const triggers = ["s1", "s2", "s3"].flatMap((lane, l) =>
      Array.from({ length: 5 }, (_, i) => firing(`${lane}-${i}`, min(l * 30 + i))),
    );
    const topology = {
      nodes: triggers.map((f) => ({
        alert_id: f.alert_id,
        alert_name: f.alert_name,
        service_name: f.alert_id.split("-")[0],
        alert_count: 1,
        first_fired_at: f.alert_fired_at,
        last_fired_at: f.alert_fired_at,
      })),
      edges: [],
      related_incident_ids: [],
    };
    const wrapper = mountGraph(incident(triggers, { topology_context: topology }));
    await wrapper.get('[data-test="autoobserve-unfold-card-fold-s2"]').trigger("click");
    await wrapper.get('[data-test="autoobserve-unfold-expand-lane"]').trigger("click");
    await wrapper.vm.$nextTick();
    const cards = wrapper.findComponent(AutoObserveUnfoldGraph).props("cards");
    expect(cards.some((c) => c.id === "fold-s2")).toBe(false);
    expect(cards.filter((c) => c.lane === "s2")).toHaveLength(5);
    expect(panelName(wrapper)).toBe("s2-2_alert");
  });
});
