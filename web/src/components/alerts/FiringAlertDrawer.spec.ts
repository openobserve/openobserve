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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createStore } from "vuex";
import i18n from "@/locales";
import alerts from "@/services/alerts";
import { queryClient } from "@/composables/query/queryClient";
import { makeAlertSectionRouter } from "@/test/unit/helpers/alertSectionRouter";
import { b64DecodeUnicode } from "@/utils/zincutils";
import type { FiringRow } from "@/utils/alerts/firingAlerts";
import { FIRING_CLOCK_MS } from "@/composables/alerts/useFiringAlerts";
import { OPENING_RUN_MARGIN_US } from "@/utils/alerts/firingHistory";
import FiringAlertDrawer from "./FiringAlertDrawer.vue";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
const downtimes = vi.hoisted(() => ({ value: true }));
vi.mock("@/composables/downtimes/useDowntimesEnabled", () => ({
  useDowntimesEnabled: () => downtimes,
}));

const store = createStore({
  state: {
    selectedOrganization: { identifier: "acme" },
    userInfo: { email: "me@acme.io" },
    timezone: "UTC",
  },
});

const NOW_US = Date.now() * 1000;
const baseRow: FiringRow = {
  alert_id: "a1",
  folder_id: "f1",
  folder_name: "payments",
  name: "checkout_5xx_rate",
  alert_type: "scheduled",
  stream_name: "nginx_logs",
  priority: 1,
  last_outcome: "firing",
  firing_started_at: NOW_US - 42 * 60_000_000,
};
const detail = {
  id: "a1",
  name: "checkout_5xx_rate",
  folder_id: "f1",
  stream_name: "nginx_logs",
  stream_type: "logs",
  destinations: ["slack", "pd"],
  query_condition: { type: "sql", sql: 'SELECT * FROM "nginx_logs"' },
  trigger_condition: { period: 5 },
};

const getDetail = vi.fn();
const getHistory = vi.fn();
const ackAlert = vi.fn();
const listAlertAcks = vi.fn();
const router = makeAlertSectionRouter();

const mountDrawer = async (row: FiringRow | null, alertId: string | null = "a1") => {
  const wrapper = mount(FiringAlertDrawer, {
    props: { alertId, row },
    attachTo: document.body,
    global: {
      provide: { store },
      plugins: [i18n, router, [VueQueryPlugin, { queryClient }]],
      stubs: {
        ODrawer: {
          props: ["open"],
          template: "<div v-if='open'><slot name='header' /><slot /></div>",
        },
        AlertGroupChart: { template: "<div data-test='chart' />" },
        QuickMuteDialog: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
};
const has = (wrapper: any, id: string) => wrapper.find(`[data-test="${id}"]`).exists();

describe("FiringAlertDrawer", () => {
  beforeEach(() => {
    queryClient.clear();
    downtimes.value = true;
    getDetail.mockReset().mockResolvedValue({ data: detail });
    ackAlert.mockReset().mockResolvedValue({
      data: { changed: true, acks: [], other_groups_unacked: 0 },
    });
    listAlertAcks.mockReset().mockResolvedValue({ data: { acks: [] } });
    getHistory.mockReset().mockResolvedValue({
      data: {
        hits: [
          {
            timestamp: NOW_US - 60_000_000,
            status: "firing",
            actual_value: 6.4,
            threshold_value: 2,
            threshold_operator: ">",
          },
        ],
      },
    });
    Object.assign(alerts as any, {
      get_by_alert_id: getDetail,
      getHistory,
      ackAlert,
      listAlertAcks,
    });
  });

  it("is closed without an alert id", async () => {
    const wrapper = await mountDrawer(null, null);
    expect(has(wrapper, "alerts-firing-drawer-body")).toBe(false);
    expect(getDetail).not.toHaveBeenCalled();
  });

  it("keeps the approved order", async () => {
    const wrapper = await mountDrawer({
      ...baseRow,
      incident: { id: "i1", title: "Checkout errors", status: "open" },
      ack: undefined,
    });
    const order = wrapper.findAll("[data-section]").map((node) => node.attributes("data-section"));
    expect(order).toEqual(["notified", "actions", "incident", "tiles", "chart", "history"]);
  });

  it("shows priority, name, state, folder and stream in the title", async () => {
    const wrapper = await mountDrawer(baseRow);
    const title = wrapper.find('[data-test="alerts-firing-drawer-title"]').text();
    for (const text of ["P1", "checkout_5xx_rate", "Firing", "payments", "nginx_logs"]) {
      expect(title).toContain(text);
    }
  });

  it("derives Now from history, and shows a dash without it", async () => {
    const wrapper = await mountDrawer(baseRow);
    expect(wrapper.find('[data-test="alerts-firing-drawer-now"]').text()).toContain("6.4");
    expect(wrapper.find('[data-test="alerts-firing-drawer-now"]').text()).toContain("threshold 2");

    getHistory.mockResolvedValue({ data: { hits: [] } });
    queryClient.clear();
    const empty = await mountDrawer(baseRow);
    expect(empty.find('[data-test="alerts-firing-drawer-now"]').text()).toContain("—");
  });

  it("acknowledges, then asks the page to re-read", async () => {
    const wrapper = await mountDrawer({ ...baseRow, firing_started_at: undefined });
    await wrapper.find('[data-test="alerts-firing-drawer-ack"]').trigger("click");
    await flushPromises();
    expect(ackAlert).toHaveBeenCalledWith("acme", "a1", { group_key: "" }, "f1");
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("pins the ack to the firing the row shows", async () => {
    const wrapper = await mountDrawer({ ...baseRow, firing_started_at: 123 });
    await wrapper.find('[data-test="alerts-firing-drawer-ack"]').trigger("click");
    await flushPromises();
    expect(ackAlert).toHaveBeenCalledWith(
      "acme",
      "a1",
      { group_key: "", firing_started_at: 123 },
      "f1",
    );
  });

  it("acknowledges every group of a multi-alert", async () => {
    const wrapper = await mountDrawer({
      ...baseRow,
      condition: { aggregation: { multi_alert: true } },
    });
    await wrapper.find('[data-test="alerts-firing-drawer-ack"]').trigger("click");
    await flushPromises();
    expect(ackAlert).toHaveBeenCalledWith("acme", "a1", { all_groups: true }, "f1");
  });

  it("offers Take over on someone else's ack and shows who holds it", async () => {
    const ack = { acked_by: "priya@acme.io", acked_at: 1, ack_source: "ui", groups_acked: 1 };
    const wrapper = await mountDrawer({ ...baseRow, ack: ack as FiringRow["ack"] });
    expect(has(wrapper, "alerts-firing-drawer-ack")).toBe(false);
    expect(wrapper.find('[data-test="alerts-firing-drawer-ack-chip"]').text()).toContain(
      "priya@acme.io",
    );
    await wrapper.find('[data-test="alerts-firing-drawer-take-over"]').trigger("click");
    await flushPromises();
    expect(ackAlert).toHaveBeenCalledWith(
      "acme",
      "a1",
      { group_key: "", firing_started_at: baseRow.firing_started_at, take_over: true },
      "f1",
    );
  });

  it("offers neither on one's own ack", async () => {
    const ack = { acked_by: "me@acme.io", acked_at: 1, ack_source: "ui", groups_acked: 1 };
    const wrapper = await mountDrawer({ ...baseRow, ack: ack as FiringRow["ack"] });
    expect(has(wrapper, "alerts-firing-drawer-ack")).toBe(false);
    expect(has(wrapper, "alerts-firing-drawer-take-over")).toBe(false);
  });

  it("words the incident note for the action on offer", async () => {
    const incident = { id: "i1", title: "Checkout errors", status: "open" };
    const open = await mountDrawer({ ...baseRow, incident });
    const note = open.find('[data-test="alerts-firing-drawer-incident"]').text();
    expect(note).toContain("Checkout errors");
    expect(note).toContain("Acknowledging here acknowledges the whole incident.");

    const ack = { acked_by: "priya@acme.io", acked_at: 1, ack_source: "ui", groups_acked: 1 };
    const held = await mountDrawer({ ...baseRow, incident, ack: ack as FiringRow["ack"] });
    expect(held.find('[data-test="alerts-firing-drawer-incident"]').text()).toContain(
      "Taking over here takes over the whole incident.",
    );
  });

  it("re-reads history on a list refresh, not on the label clock", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      const wrapper = await mountDrawer(baseRow);
      expect(getHistory).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(FIRING_CLOCK_MS * 3);
      await flushPromises();
      expect(getHistory).toHaveBeenCalledTimes(1);
      await wrapper.setProps({ refreshedAt: 1 });
      await flushPromises();
      expect(getHistory).toHaveBeenCalledTimes(2);
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("has no incident note outside an incident", async () => {
    expect(has(await mountDrawer(baseRow), "alerts-firing-drawer-incident")).toBe(false);
  });

  it("offers no ack or mute on a recovered alert", async () => {
    const wrapper = await mountDrawer({
      ...baseRow,
      last_outcome: "normal",
      firing_started_at: undefined,
    });
    expect(has(wrapper, "alerts-firing-drawer-ack")).toBe(false);
    expect(has(wrapper, "alerts-firing-drawer-mute")).toBe(false);
  });

  it("hides Mute without downtimes and while muted", async () => {
    expect(has(await mountDrawer(baseRow), "alerts-firing-drawer-mute")).toBe(true);
    const active_downtime = { id: "d", name: "d", ends_at: 1 };
    expect(
      has(await mountDrawer({ ...baseRow, active_downtime }), "alerts-firing-drawer-mute"),
    ).toBe(false);
    downtimes.value = false;
    expect(has(await mountDrawer(baseRow), "alerts-firing-drawer-mute")).toBe(false);
  });

  it("links to Logs in a new tab for the alert query and firing window", async () => {
    const wrapper = await mountDrawer(baseRow);
    const link = wrapper.find('[data-test="alerts-firing-drawer-logs"]');
    expect(link.attributes("target")).toBe("_blank");
    const url = new URL(link.attributes("href")!, "http://x");
    expect(url.searchParams.get("stream")).toBe("nginx_logs");
    expect(url.searchParams.get("sql_mode")).toBe("true");
    expect(b64DecodeUnicode(url.searchParams.get("query")!)).toContain("nginx_logs");
    expect(Number(url.searchParams.get("from"))).toBe(baseRow.firing_started_at! - 5 * 60_000_000);
  });

  it("omits Open in Logs for a PromQL alert", async () => {
    getDetail.mockResolvedValue({
      data: { ...detail, query_condition: { type: "promql", promql: "up" } },
    });
    expect(has(await mountDrawer(baseRow), "alerts-firing-drawer-logs")).toBe(false);
  });

  it("re-reads history on a refresh inside the same minute, whose key does not change", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_700_000_040_000 });
    try {
      const wrapper = await mountDrawer(baseRow);
      expect(getHistory).toHaveBeenCalledTimes(1);
      vi.setSystemTime(1_700_000_045_000);
      await wrapper.setProps({ refreshedAt: 1 });
      await flushPromises();
      expect(getHistory).toHaveBeenCalledTimes(2);
      expect(getHistory.mock.calls[1][1].end_time).toBeGreaterThan(
        getHistory.mock.calls[0][1].end_time,
      );
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("confirms a destination only from a recorded send of this firing", async () => {
    const started = NOW_US - 120_000_000;
    getHistory.mockResolvedValue({
      data: {
        hits: [
          { timestamp: NOW_US - 1000, status: "firing", success_response: "destination pd ok;" },
          { timestamp: started - 500, status: "normal" },
          {
            timestamp: started - 1000,
            status: "firing",
            success_response: "destination slack ok;",
          },
        ],
      },
    });
    const wrapper = await mountDrawer({ ...baseRow, firing_started_at: started });
    const section = wrapper.find('[data-section="notified"]');
    const dest = (group: string, id: string) =>
      section.find(`[data-group="${group}"] [data-test="alerts-firing-drawer-dest-${id}"]`);
    expect(section.text()).toContain("Notified");
    expect(section.text()).toContain("Destinations");
    expect(dest("confirmed", "pd").html()).toContain("success");
    expect(dest("unconfirmed", "slack").html()).not.toContain("success");
    expect(dest("unconfirmed", "pd").exists()).toBe(false);
  });

  it("drops the neutral label once every destination is confirmed", async () => {
    getHistory.mockResolvedValue({
      data: {
        hits: [
          {
            timestamp: NOW_US - 1000,
            status: "firing",
            success_response: "destination pd ok; destination slack ok;",
          },
        ],
      },
    });
    const wrapper = await mountDrawer(baseRow);
    const section = wrapper.find('[data-section="notified"]');
    expect(section.text()).toContain("Notified");
    expect(section.text()).not.toContain("Destinations");
  });

  it("shows a firing with no history as destinations, none confirmed", async () => {
    getHistory.mockResolvedValue({ data: { hits: [] } });
    const wrapper = await mountDrawer(baseRow);
    const section = wrapper.find('[data-section="notified"]');
    expect(section.text()).not.toContain("Notified");
    expect(section.html()).not.toContain("success");
  });

  it("marks the flap count incomplete when the read stops inside its window", async () => {
    getHistory.mockResolvedValue({
      data: { total: 5000, hits: [{ timestamp: NOW_US - 1000, status: "firing" }] },
    });
    const wrapper = await mountDrawer(baseRow);
    expect(wrapper.find('[data-test="alerts-firing-drawer-flaps"]').text()).toContain("0+");
  });

  it("names the failed destination of a Notify Failed alert", async () => {
    getHistory.mockResolvedValue({
      data: {
        hits: [
          {
            timestamp: NOW_US - 1000,
            status: "notify_failed",
            error: "Error sending notification for destination pd err: 500;",
          },
        ],
      },
    });
    const wrapper = await mountDrawer({ ...baseRow, last_outcome: "notify_failed" });
    expect(wrapper.find('[data-test="alerts-firing-drawer-failed-pd"]').text()).toContain("pd");
    expect(has(wrapper, "alerts-firing-drawer-dest-slack")).toBe(true);
    expect(has(wrapper, "alerts-firing-drawer-dest-pd")).toBe(false);
  });

  it("fetches by id when the chip does not list the alert", async () => {
    listAlertAcks.mockResolvedValue({
      data: { acks: [{ acked_by: "me@acme.io", acked_at: 1, ack_source: "ui", group_key: "" }] },
    });
    const wrapper = await mountDrawer(null);
    expect(wrapper.find('[data-test="alerts-firing-drawer-title"]').text()).toContain(
      "checkout_5xx_rate",
    );
    expect(has(wrapper, "alerts-firing-drawer-ack-chip")).toBe(true);
    expect(has(wrapper, "alerts-firing-drawer-ack")).toBe(false);
  });

  it("says so when the alert cannot be read at all", async () => {
    getDetail.mockRejectedValue(new Error("gone"));
    const wrapper = await mountDrawer(null);
    expect(has(wrapper, "alerts-firing-drawer-error")).toBe(true);
    expect(has(wrapper, "alerts-firing-drawer-body")).toBe(false);
  });

  it("reads an anomaly's history by its own id and skips the alert read", async () => {
    await mountDrawer({ ...baseRow, alert_type: "anomaly_detection" });
    expect(getDetail).not.toHaveBeenCalled();
    expect(getHistory.mock.calls[0][1]).toMatchObject({ anomaly_id: "a1" });
    expect(getHistory.mock.calls[0][1].alert_id).toBeUndefined();
  });

  it("does not show one alert's runs under the next", async () => {
    const wrapper = await mountDrawer(baseRow);
    getHistory.mockReturnValue(new Promise(() => {}));
    await wrapper.setProps({ alertId: "a2", row: { ...baseRow, alert_id: "a2" } });
    await flushPromises();
    expect(wrapper.find('[data-test="alerts-firing-drawer-now"]').text()).toContain("—");
  });

  it("keeps the last runs through a failed read", async () => {
    const wrapper = await mountDrawer(baseRow);
    getHistory.mockRejectedValue(new Error("down"));
    await queryClient.refetchQueries({ type: "active" }).catch(() => {});
    await flushPromises();
    expect(wrapper.find('[data-test="alerts-firing-drawer-now"]').text()).toContain("6.4");
    expect(has(wrapper, "alerts-firing-history-error")).toBe(false);
  });

  it("reads back far enough to cover the firing and the flap window", async () => {
    await mountDrawer({ ...baseRow, firing_started_at: NOW_US - 24 * 3_600_000_000 });
    const query = getHistory.mock.calls[0][1];
    expect(query.start_time).toBe(NOW_US - 24 * 3_600_000_000 - OPENING_RUN_MARGIN_US);
    expect(query.size).toBe(1000);
  });

  it("confirms the single opening send of a firing older than the flap window", async () => {
    const started = NOW_US - 8 * 3_600_000_000;
    const opening = {
      timestamp: started - 30_000_000,
      status: "firing",
      success_response: "destination slack ok;",
    };
    getHistory.mockImplementation(async (_org: string, query: { start_time: number }) => ({
      data: { hits: opening.timestamp >= query.start_time ? [opening] : [] },
    }));
    const wrapper = await mountDrawer({ ...baseRow, firing_started_at: started });
    const section = wrapper.find('[data-section="notified"]');
    expect(
      section
        .find('[data-group="confirmed"] [data-test="alerts-firing-drawer-dest-slack"]')
        .exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="alerts-firing-drawer-flaps"]').text()).toContain("0");
  });
});
