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
import { dropdownStubs } from "@/test/unit/helpers/dropdownStubs";
import alerts from "@/services/alerts";
import { queryClient } from "@/composables/query/queryClient";
import AlertHeaderActions from "./AlertHeaderActions.vue";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const ME = (store.state as any).userInfo.email as string;

const ackBy = (who: string) => ({
  group_key: "",
  firing_started_at: 1,
  acked_by: who,
  acked_at: 1_786_500_000_000_000,
  ack_source: "slack" as const,
});

const downtime = {
  id: "d1",
  name: "Quick mute",
  ends_at: 4_102_444_800_000_000,
  end_on_clear: { alert_id: "a1", group_key: null },
};

let wrapper: VueWrapper<any>;

const mountActions = async (props: Record<string, unknown> = {}) => {
  wrapper = mount(AlertHeaderActions, {
    props: {
      alertId: "a1",
      name: "checkout-error-rate",
      folderId: "ops",
      firing: true,
      unackedGroups: null,
      ack: null,
      downtime: null,
      muteEnabled: true,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        ...dropdownStubs,
        QuickMuteDialog: {
          name: "QuickMuteDialog",
          props: ["open", "selection", "alert"],
          template: "<div />",
        },
        AlertMuteUntilDialog: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
};

const find = (test: string) => wrapper.find(`[data-test="${test}"]`);

describe("AlertHeaderActions", () => {
  beforeEach(() => {
    queryClient.clear();
    for (const fn of Object.values(alerts)) if (vi.isMockFunction(fn)) fn.mockReset();
  });
  afterEach(() => wrapper?.unmount());

  it("makes Acknowledge the primary action of a firing single-row alert", async () => {
    vi.mocked(alerts.ackAlert).mockResolvedValue({
      data: { changed: true, acks: [ackBy(ME)], other_groups_unacked: 0 },
    } as any);
    await mountActions();
    const button = find("alerts-alertdetail-ack");
    expect(button.text()).toBe("Acknowledge");
    await button.trigger("click");
    await flushPromises();
    expect(alerts.ackAlert).toHaveBeenCalledWith("default", "a1", { group_key: "" }, "ops");
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("acknowledges every un-acked firing group of a multi-alert from the header", async () => {
    vi.mocked(alerts.ackAlert).mockResolvedValue({
      data: { changed: true, acks: [], other_groups_unacked: 0 },
    } as any);
    await mountActions({ unackedGroups: 2 });
    const button = find("alerts-alertdetail-ack");
    expect(button.text()).toBe("Acknowledge 2 firing groups");
    await button.trigger("click");
    await flushPromises();
    expect(alerts.ackAlert).toHaveBeenCalledWith("default", "a1", { all_groups: true }, "ops");
  });

  it("offers no Acknowledge when nothing is firing or every group is acked", async () => {
    await mountActions({ firing: false });
    expect(find("alerts-alertdetail-ack").exists()).toBe(false);
    wrapper.unmount();
    await mountActions({ unackedGroups: 0 });
    expect(find("alerts-alertdetail-ack").exists()).toBe(false);
  });

  it("moves Unacknowledge and Take over into the overflow menu after someone else's ack", async () => {
    vi.mocked(alerts.ackAlert).mockResolvedValue({
      data: { changed: true, acks: [ackBy(ME)], other_groups_unacked: 0 },
    } as any);
    await mountActions({ ack: ackBy("bob@acme.io") });
    expect(find("alerts-alertdetail-ack").exists()).toBe(false);
    expect(find("alerts-alertdetail-unack").exists()).toBe(true);
    await find("alerts-alertdetail-take-over").trigger("click");
    await flushPromises();
    expect(alerts.ackAlert).toHaveBeenCalledWith(
      "default",
      "a1",
      { group_key: "", take_over: true },
      "ops",
    );
  });

  it("does not offer to take over one's own ack", async () => {
    vi.mocked(alerts.unackAlert).mockResolvedValue({ data: { changed: true } } as any);
    await mountActions({ ack: ackBy(ME) });
    expect(find("alerts-alertdetail-take-over").exists()).toBe(false);
    await find("alerts-alertdetail-unack").trigger("click");
    await flushPromises();
    expect(alerts.unackAlert).toHaveBeenCalledWith("default", "a1", { group_key: "" }, "ops");
  });

  it("opens Mute with Until it clears first and mutes through the alert route", async () => {
    vi.mocked(alerts.muteAlert).mockResolvedValue({
      data: { downtime_id: "d1", version: 1, ends_at: downtime.ends_at },
    } as any);
    await mountActions();
    const items = wrapper
      .findAll('[data-test^="alerts-alertdetail-mute-"]')
      .map((el) => el.attributes("data-test"));
    expect(items[0]).toBe("alerts-alertdetail-mute-until-clear");
    await find("alerts-alertdetail-mute-until-clear").trigger("click");
    await flushPromises();
    expect(alerts.muteAlert).toHaveBeenCalledWith("default", "a1", { until_clear: true }, "ops");
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("opens Quick Mute on the alert route from Until…, scoped to this alert", async () => {
    await mountActions();
    const dialog = () => wrapper.findComponent({ name: "QuickMuteDialog" });
    expect(dialog().props("open")).toBe(false);
    await find("alerts-alertdetail-mute-until").trigger("click");
    expect(dialog().props("open")).toBe(true);
    expect(dialog().props("alert")).toEqual({
      alertId: "a1",
      name: "checkout-error-rate",
      folderId: "ops",
      groups: undefined,
    });
  });

  it("offers a multi-alert's firing groups to the Groups field, all groups by default", async () => {
    await mountActions({
      unackedGroups: 1,
      groups: [
        {
          group_key: "k-eu",
          labels: [{ name: "cluster", value: "prod-eu" }],
          last_outcome: "firing",
          firing_started_at: 7,
        },
      ],
    });
    await find("alerts-alertdetail-mute-until").trigger("click");
    expect(wrapper.findComponent({ name: "QuickMuteDialog" }).props("alert")).toEqual({
      alertId: "a1",
      name: "checkout-error-rate",
      folderId: "ops",
      groups: [
        {
          key: "k-eu",
          labels: [{ name: "cluster", value: "prod-eu" }],
          labelsText: undefined,
          firingStartedAt: 7,
        },
      ],
    });
  });

  it("swaps Mute for Extend and End mute while a mute is active", async () => {
    vi.mocked(alerts.cancelAlertMute).mockResolvedValue({ data: {} } as any);
    await mountActions({ downtime });
    expect(find("alerts-alertdetail-mute").exists()).toBe(false);
    expect(find("alerts-alertdetail-extend").exists()).toBe(true);
    expect(find("alerts-alertdetail-extend-until-clear").exists()).toBe(true);
    await find("alerts-alertdetail-end-mute").trigger("click");
    await flushPromises();
    expect(alerts.cancelAlertMute).toHaveBeenCalledWith("default", "a1", "d1", "ops");
  });

  it("shows no mute controls where downtimes are off", async () => {
    await mountActions({ muteEnabled: false, downtime });
    expect(find("alerts-alertdetail-mute").exists()).toBe(false);
    expect(find("alerts-alertdetail-extend").exists()).toBe(false);
    expect(find("alerts-alertdetail-end-mute").exists()).toBe(false);
  });
});
