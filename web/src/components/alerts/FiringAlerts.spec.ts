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
import analytics from "@/services/product_analytics";
import FiringAlerts from "./FiringAlerts.vue";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const downtimes = ref(true);
vi.mock("@/composables/downtimes/useDowntimesEnabled", () => ({
  useDowntimesEnabled: () => downtimes,
}));

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

const listByFolderId = vi.fn();
const ackAlert = vi.fn();
const router = makeAlertSectionRouter();
const respond = (list: unknown[], extra = {}) => ({ data: { list, ...extra } });

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
    listByFolderId.mockReset();
    ackAlert.mockReset();
    vi.mocked(toast).mockClear();
    (alerts as any).listByFolderId = listByFolderId;
    (alerts as any).ackAlert = ackAlert;
    listByFolderId.mockResolvedValue(respond(rowsFixture));
    await router.push({ name: "alertFiring" });
    await router.isReady();
  });

  it("shows the four chips with counts worked out from the rows, in order", async () => {
    const wrapper = await mountPage();
    const chips = wrapper.find('[data-test="alerts-firing-chips"]');
    const ids = chips.findAll("[data-test^='alerts-firing-chip-']").map((c) => c.text());
    expect(ids).toEqual(["Firing 3", "Acknowledged 0", "Muted 0", "Not delivered 1"]);
    wrapper.unmount();
  });

  it("drops the Muted chip when downtimes are off", async () => {
    downtimes.value = false;
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="alerts-firing-chip-muted"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders rows in triage order, whatever the server's order", async () => {
    listByFolderId.mockResolvedValue(respond([...rowsFixture].reverse()));
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
    vi.mocked(analytics.track).mockClear();
    await bodyRows(wrapper)[1].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.alert).toBe("2");
    expect(analytics.track).toHaveBeenCalledWith("alert_firing_detail_opened");
    wrapper.findComponent({ name: "FiringAlertDrawer" }).vm.$emit("close");
    await flushPromises();
    expect(router.currentRoute.value.query.alert).toBeUndefined();
    wrapper.unmount();
  });

  it("says nothing is firing, with no action, on a healthy list", async () => {
    listByFolderId.mockResolvedValue(respond([]));
    const wrapper = await mountPage();
    const empty = wrapper.find('[data-test="alerts-firing-empty"]');
    expect(empty.text()).toContain("Nothing firing");
    expect(empty.find("button").exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows the banner and Retry, never Nothing firing, when the run state is unavailable", async () => {
    listByFolderId.mockResolvedValue(respond([], { status_unavailable: true }));
    const wrapper = await mountPage();
    const banner = wrapper.find('[data-test="alerts-firing-stale-banner"]');
    expect(banner.text()).toContain("Alert status is unavailable");
    expect(wrapper.text()).not.toContain("Nothing firing");
    expect(wrapper.find('[data-test="alerts-firing-chip-firing"]').text()).toBe("Firing");
    listByFolderId.mockResolvedValue(respond(rowsFixture));
    await wrapper.find('[data-test="alerts-firing-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="alerts-firing-stale-banner"]').exists()).toBe(false);
    expect(bodyRows(wrapper)).toHaveLength(3);
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
    listByFolderId.mockRejectedValue({ response: { status: 400 }, message: "timeout" });
    await queryClient.refetchQueries();
    await flushPromises();
    const banner = wrapper.find('[data-test="alerts-firing-stale-banner"]');
    expect(banner.text()).toContain("Couldn't refresh firing alerts (timeout).");
    expect(bodyRows(wrapper)).toHaveLength(3);
    expect(wrapper.find('[data-test="alerts-firing-stale"]').exists()).toBe(true);
    listByFolderId.mockResolvedValue(respond(rowsFixture));
    await wrapper.find('[data-test="alerts-firing-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="alerts-firing-stale-banner"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("tracks opening an alert and switching the state chip", async () => {
    const wrapper = await mountPage();
    vi.mocked(analytics.track).mockClear();
    (wrapper.vm as any).openAlert(rowsFixture[0]);
    (wrapper.vm as any).selectState("muted");
    expect(vi.mocked(analytics.track).mock.calls).toEqual([
      ["alert_firing_detail_opened"],
      ["alert_firing_state_filtered", { state: "muted" }],
    ]);
    wrapper.unmount();
  });

  it("reports a bulk failure apart from skips, with its reason", async () => {
    ackAlert
      .mockResolvedValueOnce({ data: { changed: true, acks: [] } })
      .mockRejectedValueOnce({ response: { status: 409, data: { code: "firing_changed" } } });
    const wrapper = await mountPage();
    const table = wrapper.findComponent({ name: "OTable" });
    table.vm.$emit("update:selectedIds", ["1", "2", "3"]);
    await flushPromises();
    const ack = wrapper.find('[data-test="alerts-firing-bulk-ack"]');
    expect(ack.text()).toBe("Acknowledge 3");
    await ack.trigger("click");
    await flushPromises();
    expect(ackAlert).toHaveBeenCalledTimes(2);
    const messages = vi.mocked(toast).mock.calls.map(([call]) => call.message);
    expect(messages[0]).toBe("1 acknowledged, 1 skipped, 1 failed");
    expect(messages[1]).toBe(i18n.global.t("alerts.ack.errors.firingChanged"));
    expect(analytics.track).toHaveBeenCalledWith("alert_acknowledged", { count: 1 });
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
    listByFolderId.mockResolvedValue(
      respond([{ ...rowsFixture[1], active_downtime: { id: "d1" } }]),
    );
    const wrapper = await mountPage();
    wrapper.findComponent({ name: "OTable" }).vm.$emit("update:selectedIds", ["2"]);
    await flushPromises();
    expect(wrapper.find('[data-test="alerts-firing-bulk-mute"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("counts skipped rows from the batch, even when a refetch empties the table mid-ack", async () => {
    const org = store.state.selectedOrganization.identifier;
    ackAlert.mockImplementation(async (_org: string, id: string) => {
      queryClient.setQueryData(firingAlertsQuery(org).queryKey, respond([]).data);
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

    it("follows an acked row out of the Firing chip", async () => {
      await router.push({ name: "alertFiring", query: { alert: "2" } });
      const wrapper = await mountPage();
      const ack = { acked_by: "p@x", acked_at: 1, ack_source: "ui", groups_acked: 1 };
      listByFolderId.mockResolvedValue(
        respond([rowsFixture[0], { ...rowsFixture[1], firing_started_at: 5, ack }]),
      );
      await queryClient.refetchQueries();
      await flushPromises();
      expect(drawerRow(wrapper).ack).toEqual(ack);
      expect(drawerRow(wrapper).firing_started_at).toBe(5);
      wrapper.unmount();
    });

    it("finds a deep-linked alert no firing chip lists", async () => {
      const healthy = { ...rowsFixture[1], alert_id: "9", last_outcome: "normal" };
      listByFolderId.mockResolvedValue(respond([...rowsFixture, healthy]));
      await router.push({ name: "alertFiring", query: { alert: "9" } });
      const wrapper = await mountPage();
      expect(drawerRow(wrapper).last_outcome).toBe("normal");
      wrapper.unmount();
    });

    it("keeps the last known row, anomaly type included, when the list drops it", async () => {
      const anomaly = { ...rowsFixture[1], alert_type: "anomaly_detection" };
      listByFolderId.mockResolvedValue(respond([anomaly]));
      await router.push({ name: "alertFiring", query: { alert: "2" } });
      const wrapper = await mountPage();
      listByFolderId.mockResolvedValue(respond([]));
      await queryClient.refetchQueries();
      await flushPromises();
      expect(drawerRow(wrapper).alert_type).toBe("anomaly_detection");
      wrapper.unmount();
    });

    it("reads the list once, however many chips are visited", async () => {
      await router.push({ name: "alertFiring", query: { alert: "2" } });
      const wrapper = await mountPage();
      await wrapper.find('[data-test="alerts-firing-chip-acked"]').trigger("click");
      await flushPromises();
      expect(listByFolderId).toHaveBeenCalledTimes(1);
      expect(analytics.track).toHaveBeenCalledWith("alert_firing_state_filtered", {
        state: "acked",
      });
      wrapper.unmount();
    });
  });
});
