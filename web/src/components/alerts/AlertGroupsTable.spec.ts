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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { OTableRowsStub, dropdownStubs } from "@/test/unit/helpers/dropdownStubs";
import alerts from "@/services/alerts";
import { queryClient } from "@/composables/query/queryClient";
import type { AlertGroup } from "@/ts/interfaces/alert";
import AlertGroupsTable from "./AlertGroupsTable.vue";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const ME = (store.state as any).userInfo.email as string;

const ack = (who: string, group_key: string) => ({
  group_key,
  firing_started_at: 100,
  acked_by: who,
  acked_at: 1_786_500_000_000_000,
  ack_source: "slack" as const,
});

const groups: AlertGroup[] = [
  {
    group_key: "eu",
    group_labels: "cluster=prod-eu",
    last_outcome: "firing",
    firing_started_at: 100,
  },
  {
    group_key: "us",
    group_labels: "cluster=prod-us",
    last_outcome: "firing",
    firing_started_at: 100,
    ack: ack("bob@acme.io", "us"),
  },
  {
    group_key: "ap",
    group_labels: "cluster=prod-ap",
    last_outcome: "firing",
    firing_started_at: 100,
  },
  { group_key: "st", group_labels: "cluster=staging-eu", last_outcome: "ok" },
];

const groupMute = {
  id: "d1",
  name: "Quick mute",
  ends_at: 4_102_444_800_000_000,
  version: 2,
  alert_groups: [{ alert_id: "a1", group_key: "ap" }],
};

let wrapper: VueWrapper<any>;

const mountTable = async (props: Record<string, unknown> = {}) => {
  wrapper = mount(AlertGroupsTable, {
    props: {
      groups,
      alertId: "a1",
      alertName: "checkout-error-rate-by-cluster",
      folderId: "ops",
      downtime: null,
      muteEnabled: true,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        ...dropdownStubs,
        OTable: OTableRowsStub,
        AlertMuteUntilDialog: true,
        QuickMuteDialog: {
          name: "QuickMuteDialog",
          props: ["open", "selection", "alert"],
          template: "<div />",
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

const find = (test: string) => wrapper.find(`[data-test="${test}"]`);

describe("AlertGroupsTable row actions", () => {
  beforeEach(() => {
    queryClient.clear();
    for (const fn of Object.values(alerts)) if (vi.isMockFunction(fn)) fn.mockReset();
  });
  afterEach(() => wrapper?.unmount());

  it("acknowledges one firing group with the firing it showed", async () => {
    vi.mocked(alerts.ackAlert).mockResolvedValue({
      data: { changed: true, acks: [ack(ME, "eu")], other_groups_unacked: 1 },
    } as any);
    await mountTable();
    await find("alerts-alertgroupstable-ack-eu").trigger("click");
    await flushPromises();
    expect(alerts.ackAlert).toHaveBeenCalledWith(
      "default",
      "a1",
      { group_key: "eu", firing_started_at: 100 },
      "ops",
    );
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("offers Unacknowledge and Take over on someone else's acked group, not Acknowledge", async () => {
    await mountTable();
    expect(find("alerts-alertgroupstable-ack-us").exists()).toBe(false);
    expect(find("alerts-alertgroupstable-unack-us").exists()).toBe(true);
    expect(find("alerts-alertgroupstable-take-over-us").exists()).toBe(true);
  });

  it("offers no Acknowledge on a group that is not firing", async () => {
    await mountTable();
    expect(find("alerts-alertgroupstable-ack-st").exists()).toBe(false);
  });

  it("shows who acknowledged a group in Last outcome", async () => {
    await mountTable();
    const cell = find("alerts-alertgroupstable-outcome-us");
    expect(cell.text()).toContain("Acknowledged");
    expect(cell.text()).toContain("bob");
  });

  it("opens Quick Mute from a group's Until…, scoped to that group", async () => {
    await mountTable();
    await find("alerts-alertgroupstable-mute-eu-until").trigger("click");
    const dialog = wrapper.findComponent({ name: "QuickMuteDialog" });
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("alert")).toMatchObject({
      alertId: "a1",
      name: "checkout-error-rate-by-cluster",
      folderId: "ops",
      groupKey: "eu",
    });
    expect(dialog.props("alert").groups.map((g: { key: string }) => g.key)).toEqual([
      "eu",
      "us",
      "ap",
    ]);
  });

  it("mutes only this group, Until it clears first", async () => {
    vi.mocked(alerts.muteAlert).mockResolvedValue({
      data: { downtime_id: "d9", version: 1, ends_at: groupMute.ends_at },
    } as any);
    await mountTable();
    const group = wrapper.find('[data-group-label="Mute this group"]');
    expect(group.exists()).toBe(true);
    await find("alerts-alertgroupstable-mute-eu-until-clear").trigger("click");
    await flushPromises();
    expect(alerts.muteAlert).toHaveBeenCalledWith(
      "default",
      "a1",
      { until_clear: true, group_keys: ["eu"], firing_started_at: 100 },
      "ops",
    );
  });

  it("offers Extend by and End mute now on a muted group only", async () => {
    vi.mocked(alerts.extendAlertMute).mockResolvedValue({
      data: { version: 3, ends_at: groupMute.ends_at },
    } as any);
    await mountTable({ downtime: groupMute });
    expect(find("alerts-alertgroupstable-extend-ap-1h").exists()).toBe(true);
    expect(find("alerts-alertgroupstable-end-mute-ap").exists()).toBe(true);
    expect(find("alerts-alertgroupstable-end-mute-eu").exists()).toBe(false);
    expect(find("alerts-alertgroupstable-outcome-ap").text()).toContain("Muted");
    await find("alerts-alertgroupstable-extend-ap-1h").trigger("click");
    await flushPromises();
    expect(alerts.extendAlertMute).toHaveBeenCalledWith(
      "default",
      "a1",
      "d1",
      { version: 2, minutes: 60 },
      "ops",
    );
  });

  it("keeps the group's history one click away, in the menu and as the icon", async () => {
    await mountTable();
    await find("alerts-alertgroupstable-menu-history-eu").trigger("click");
    await find("alerts-alertgroupstable-history-eu").trigger("click");
    expect(wrapper.emitted("show-history")).toHaveLength(2);
  });

  it("hides the mute entries where downtimes are off", async () => {
    await mountTable({ muteEnabled: false });
    expect(find("alerts-alertgroupstable-mute-eu-until-clear").exists()).toBe(false);
    expect(find("alerts-alertgroupstable-ack-eu").exists()).toBe(true);
  });
});
