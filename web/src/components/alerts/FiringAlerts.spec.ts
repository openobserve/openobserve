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
import { ref } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { makeAlertSectionRouter } from "@/test/unit/helpers/alertSectionRouter";
import { queryClient } from "@/composables/query/queryClient";
import alerts from "@/services/alerts";
import { firingAlertsQuery } from "@/services/alerts.queries";
import { toast } from "@/lib/feedback/Toast/useToast";
import FiringAlerts from "./FiringAlerts.vue";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const downtimes = ref(true);
vi.mock("@/composables/downtimes/useDowntimesEnabled", () => ({
  useDowntimesEnabled: () => downtimes,
}));

const STATES = { firing: 8, acked: 2, muted: 3, failed: 1, recovered: 4 };
const rowsFixture = [
  {
    alert_id: "1",
    name: "payments_webhook_errors",
    folder_id: "f1",
    folder_name: "payments",
    alert_type: "scheduled",
    stream_name: "nginx_logs",
    priority: 1,
    last_outcome: "notify_failed",
  },
  {
    alert_id: "2",
    name: "checkout_5xx_rate",
    folder_id: "f1",
    folder_name: "payments",
    alert_type: "scheduled",
    stream_name: "nginx_logs",
    priority: 2,
    last_outcome: "firing",
  },
  {
    alert_id: "3",
    name: "cert_expiry",
    folder_id: "f2",
    folder_name: "security",
    alert_type: "scheduled",
    stream_name: "k8s_events",
    last_outcome: "firing",
    ack: { acked_by: "p@x", acked_at: 1, ack_source: "ui" },
  },
];

const listByState = vi.fn();
const ackAlert = vi.fn();
const router = makeAlertSectionRouter();
const respond = (list: unknown[], extra = {}) => ({
  data: { list, counts: STATES, total: list.length, ...extra },
});

const mountPage = async () => {
  const wrapper = mount(FiringAlerts, {
    attachTo: document.body,
    global: {
      provide: { store },
      plugins: [i18n, router],
      stubs: { OPageLayout: { template: "<div><slot name='header-tabs' /><slot /></div>" } },
    },
  });
  await flushPromises();
  return wrapper;
};
const bodyRows = (wrapper: any) => wrapper.findAll('[data-test^="alerts-firing-row-name-"]');

describe("FiringAlerts", () => {
  beforeEach(async () => {
    queryClient.clear();
    downtimes.value = true;
    listByState.mockReset();
    ackAlert.mockReset();
    vi.mocked(toast).mockClear();
    (alerts as any).listByState = listByState;
    (alerts as any).ackAlert = ackAlert;
    listByState.mockResolvedValue(respond(rowsFixture));
    await router.push({ name: "alertFiring" });
    await router.isReady();
  });

  it("shows the five chips with their counts, in order", async () => {
    const wrapper = await mountPage();
    const chips = wrapper.find('[data-test="alerts-firing-chips"]');
    expect(chips.text()).toContain("Firing 8");
    const ids = chips.findAll("[data-test^='alerts-firing-chip-']").map((c) => c.text());
    expect(ids).toEqual([
      "Firing 8",
      "Acknowledged 2",
      "Muted 3",
      "Not delivered 1",
      "Recovered 4",
    ]);
    wrapper.unmount();
  });

  it("drops the Muted chip when downtimes are off", async () => {
    downtimes.value = false;
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="alerts-firing-chip-muted"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders rows in the server's order", async () => {
    const wrapper = await mountPage();
    expect(bodyRows(wrapper).map((r: any) => r.text())).toEqual([
      "payments_webhook_errors",
      "checkout_5xx_rate",
      "cert_expiry",
    ]);
    wrapper.unmount();
  });

  it("falls back to the stream on the subline", async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="alerts-firing-row-sub-1"]').text()).toBe("nginx_logs");
    wrapper.unmount();
  });

  it("opens the deep-linked alert in the drawer seam", async () => {
    await router.push({ name: "alertFiring", query: { alert: "2" } });
    const wrapper = await mountPage();
    const drawer = wrapper.findComponent({ name: "FiringAlertDrawer" });
    expect(drawer.props("alertId")).toBe("2");
    expect((drawer.props("row") as any).name).toBe("checkout_5xx_rate");
    wrapper.unmount();
  });

  it("selects the row in the URL on click and clears it on close", async () => {
    const wrapper = await mountPage();
    await bodyRows(wrapper)[1].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.alert).toBe("2");
    wrapper.findComponent({ name: "FiringAlertDrawer" }).vm.$emit("close");
    await flushPromises();
    expect(router.currentRoute.value.query.alert).toBeUndefined();
    wrapper.unmount();
  });

  it("shows the last recovery and offers Recovered when nothing fires", async () => {
    listByState.mockResolvedValue(
      respond([], { last_recovered: { name: "disk_80pct", at: (Date.now() - 7_200_000) * 1000 } }),
    );
    const wrapper = await mountPage();
    const empty = wrapper.find('[data-test="alerts-firing-empty"]');
    expect(empty.text()).toContain("Nothing firing");
    expect(empty.text()).toContain("Last alert recovered 2h ago (disk_80pct).");
    await empty.find("button").trigger("click");
    await flushPromises();
    expect(listByState.mock.calls.map((c) => c[1])).toContain("recovered");
    wrapper.unmount();
  });

  it("uses the filtered empty state once a filter hides every row", async () => {
    const wrapper = await mountPage();
    const search = wrapper.find('[data-test="alerts-firing-search"] input');
    await search.setValue("no_such_alert");
    await flushPromises();
    expect(wrapper.find('[data-test="alerts-firing-empty"]').text()).not.toContain(
      "Nothing firing",
    );
    wrapper.unmount();
  });

  it("shows the stale banner with Retry after a failed refresh", async () => {
    const wrapper = await mountPage();
    listByState.mockRejectedValue({ response: { status: 400 }, message: "timeout" });
    await queryClient.refetchQueries();
    await flushPromises();
    const banner = wrapper.find('[data-test="alerts-firing-stale-banner"]');
    expect(banner.text()).toContain("Couldn't refresh firing alerts (timeout).");
    expect(bodyRows(wrapper)).toHaveLength(3);
    expect(wrapper.find('[data-test="alerts-firing-stale"]').exists()).toBe(true);
    listByState.mockResolvedValue(respond(rowsFixture));
    await wrapper.find('[data-test="alerts-firing-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="alerts-firing-stale-banner"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("reports a partial bulk acknowledge in one toast", async () => {
    ackAlert
      .mockResolvedValueOnce({ data: { changed: true, acks: [] } })
      .mockRejectedValueOnce({ response: { status: 403 } });
    const wrapper = await mountPage();
    const table = wrapper.findComponent({ name: "OTable" });
    table.vm.$emit("update:selectedIds", ["1", "2", "3"]);
    await flushPromises();
    const ack = wrapper.find('[data-test="alerts-firing-bulk-ack"]');
    expect(ack.text()).toBe("Acknowledge 3");
    await ack.trigger("click");
    await flushPromises();
    expect(ackAlert).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast).mock.calls[0][0].message).toBe("1 acknowledged, 2 skipped");
    wrapper.unmount();
  });

  it("offers Mute only for one selected row", async () => {
    const wrapper = await mountPage();
    const table = wrapper.findComponent({ name: "OTable" });
    table.vm.$emit("update:selectedIds", ["1"]);
    await flushPromises();
    expect(wrapper.find('[data-test="alerts-firing-bulk-mute"]').exists()).toBe(true);
    table.vm.$emit("update:selectedIds", ["1", "2"]);
    await flushPromises();
    expect(wrapper.find('[data-test="alerts-firing-bulk-mute"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("sorts every column but State, ranking the urgent and the oldest highest", async () => {
    const wrapper = await mountPage();
    const columns = wrapper.findComponent({ name: "OTable" }).props("columns") as any[];
    expect(columns.filter((column) => column.sortable).map((column) => column.id)).toEqual([
      "priority",
      "name",
      "folder_name",
      "firing_for",
    ]);
    const rank = (id: string, row: object) =>
      columns.find((column) => column.id === id).accessorFn(row);
    expect(rank("priority", { priority: 1 })).toBeGreaterThan(rank("priority", { priority: 5 }));
    expect(rank("priority", {})).toBeUndefined();
    expect(rank("firing_for", { firing_started_at: 1 })).toBeGreaterThan(
      rank("firing_for", { firing_started_at: 2 }),
    );
    wrapper.unmount();
  });

  it("hides bulk Acknowledge when no selected row can take it", async () => {
    const wrapper = await mountPage();
    const table = wrapper.findComponent({ name: "OTable" });
    table.vm.$emit("update:selectedIds", ["3"]);
    await flushPromises();
    expect(wrapper.find('[data-test="alerts-firing-bulk-ack"]').exists()).toBe(false);
    table.vm.$emit("update:selectedIds", ["3", "2"]);
    await flushPromises();
    expect(wrapper.find('[data-test="alerts-firing-bulk-ack"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("offers no bulk Mute for a row already muted", async () => {
    listByState.mockResolvedValue(respond([{ ...rowsFixture[1], active_downtime: { id: "d1" } }]));
    const wrapper = await mountPage();
    wrapper.findComponent({ name: "OTable" }).vm.$emit("update:selectedIds", ["2"]);
    await flushPromises();
    expect(wrapper.find('[data-test="alerts-firing-bulk-mute"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("counts skipped rows from the batch, even when a poll empties the table mid-ack", async () => {
    const org = store.state.selectedOrganization.identifier;
    ackAlert.mockImplementation(async (_org: string, id: string) => {
      queryClient.setQueryData(firingAlertsQuery(org, "firing").queryKey, respond([]).data);
      await flushPromises();
      return { data: { changed: id === "1", acks: [] } };
    });
    const wrapper = await mountPage();
    wrapper.findComponent({ name: "OTable" }).vm.$emit("update:selectedIds", ["1", "2"]);
    await flushPromises();
    await wrapper.find('[data-test="alerts-firing-bulk-ack"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(toast).mock.calls.map(([call]) => call.message)).toContain(
      "1 acknowledged, 1 skipped",
    );
    wrapper.unmount();
  });

  describe("the drawer's row once it leaves the open chip", () => {
    const drawerRow = (wrapper: any) =>
      wrapper.findComponent({ name: "FiringAlertDrawer" }).props("row") as any;
    const byState = (lists: Record<string, unknown[]>) =>
      listByState.mockImplementation(async (_org: string, state: string) =>
        respond(lists[state] ?? []),
      );

    it("follows an acked row into the Acknowledged list", async () => {
      await router.push({ name: "alertFiring", query: { alert: "2" } });
      const wrapper = await mountPage();
      const ack = { acked_by: "p@x", acked_at: 1, ack_source: "ui", groups_acked: 1 };
      byState({
        firing: [rowsFixture[0]],
        acked: [{ ...rowsFixture[1], firing_started_at: 5, ack }],
      });
      await queryClient.refetchQueries();
      await flushPromises();
      expect(drawerRow(wrapper).ack).toEqual(ack);
      expect(drawerRow(wrapper).firing_started_at).toBe(5);
      wrapper.unmount();
    });

    it("finds a deep-linked muted alert the Firing chip never listed", async () => {
      const muted = { ...rowsFixture[1], alert_id: "9", active_downtime: { id: "d1" } };
      byState({ firing: rowsFixture, muted: [muted] });
      await router.push({ name: "alertFiring", query: { alert: "9" } });
      const wrapper = await mountPage();
      expect(drawerRow(wrapper).active_downtime).toEqual({ id: "d1" });
      wrapper.unmount();
    });

    it("keeps the last known row, anomaly type included, when no list has it", async () => {
      const anomaly = { ...rowsFixture[1], alert_type: "anomaly_detection" };
      byState({ firing: [anomaly] });
      await router.push({ name: "alertFiring", query: { alert: "2" } });
      const wrapper = await mountPage();
      byState({ firing: [] });
      await queryClient.refetchQueries();
      await flushPromises();
      expect(drawerRow(wrapper).alert_type).toBe("anomaly_detection");
      wrapper.unmount();
    });

    it("never reads the open chip twice", async () => {
      await router.push({ name: "alertFiring", query: { alert: "2" } });
      const wrapper = await mountPage();
      expect(listByState.mock.calls.map((c) => c[1])).toEqual(["firing"]);
      wrapper.unmount();
    });
  });
});
