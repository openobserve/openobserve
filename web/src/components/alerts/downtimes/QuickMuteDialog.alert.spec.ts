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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import alerts from "@/services/alerts";
import common from "@/services/common";
import downtimes from "@/services/downtimes";
import { queryClient } from "@/composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import QuickMuteDialog from "./QuickMuteDialog.vue";
import type { QuickMuteAlertContext } from "@/utils/downtimes/quickMute";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/services/common", () => ({ default: { list_Folders: vi.fn() } }));
vi.mock("@/services/downtimes", () => ({ default: { quickMute: vi.fn(), create: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const ENDS_AT = 4_102_444_800_000_000;

const single: QuickMuteAlertContext = {
  alertId: "a1",
  name: "checkout-error-rate",
  folderId: "ops",
};

const grouped: QuickMuteAlertContext = {
  alertId: "a2",
  name: "checkout-error-rate-by-cluster",
  folderId: "ops",
  groupKey: "k-eu",
  groups: [
    {
      key: "k-eu",
      labels: [{ name: "cluster", value: "prod-eu" }],
      firingStartedAt: 1_786_500_000_000_000,
    },
    { key: "k-us", labels: [{ name: "cluster", value: "prod-us" }] },
  ],
};

let wrapper: VueWrapper<any>;

const mountDialog = async (alert: QuickMuteAlertContext | null, folders = ["payments"]) => {
  vi.mocked(common.list_Folders).mockResolvedValue({
    data: { list: folders.map((f) => ({ folderId: f, name: f })) },
  } as never);
  wrapper = mount(QuickMuteDialog, {
    props: { open: false, selection: [{ module: "alerts", ids: [alert?.alertId ?? "a1"] }], alert },
    global: { plugins: [i18n, store] },
    attachTo: document.body,
  });
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
};

const el = (test: string) => document.body.querySelector<HTMLElement>(`[data-test="${test}"]`);

const click = async (test: string) => {
  el(test)!.click();
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
};

const presetKeys = () =>
  [...document.body.querySelectorAll('[data-test^="quick-mute-preset-"]')].map((n) =>
    n.getAttribute("data-test"),
  );

describe("Quick Mute from an alert screen (MK-4)", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(toast).mockReset();
    for (const fn of Object.values(alerts)) if (vi.isMockFunction(fn)) fn.mockReset();
    vi.mocked(alerts.muteAlert).mockResolvedValue({
      data: { downtime_id: "d1", version: 1, ends_at: ENDS_AT },
    } as never);
  });
  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = "";
  });

  it("puts Until it clears first and selected, and names the alert in the title", async () => {
    await mountDialog(single);
    expect(presetKeys()[0]).toBe("quick-mute-preset-untilClear");
    expect(el("quick-mute-preset-untilClear")?.getAttribute("data-state")).toBe("on");
    expect(document.body.textContent).toContain("Mute checkout-error-rate");
    expect(el("quick-mute-until-clear-hint")?.textContent).toContain(
      "Ends when the alert recovers, or after 24 h at the latest.",
    );
    expect(el("o-dialog-primary-btn")?.textContent).toContain("Mute until it clears");
  });

  it("mutes through the alert route, never the generic downtime route", async () => {
    await mountDialog(single);
    await click("o-dialog-primary-btn");
    expect(alerts.muteAlert).toHaveBeenCalledWith(
      "default",
      "a1",
      { until_clear: true, folder_id: "payments" },
      "ops",
    );
    expect(downtimes.quickMute).not.toHaveBeenCalled();
    expect(downtimes.create).not.toHaveBeenCalled();
    expect(wrapper.emitted("muted")).toEqual([["d1"]]);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("sends a timed preset as minutes", async () => {
    await mountDialog(single);
    await click("quick-mute-preset-4h");
    await click("o-dialog-primary-btn");
    expect(vi.mocked(alerts.muteAlert).mock.calls[0][2]).toMatchObject({ minutes: 240 });
  });

  it("asks to confirm 24 h inside the dialog as soon as it is picked (MK-4)", async () => {
    await mountDialog(single);
    expect(el("quick-mute-confirm-24h")).toBeNull();
    await click("quick-mute-preset-24h");
    expect(alerts.muteAlert).not.toHaveBeenCalled();
    expect(el("quick-mute-confirm-24h")?.textContent).toContain("Mute for 24 hours?");
    expect(el("o-dialog-primary-btn")?.textContent).toContain("Mute 24 h");
    await click("quick-mute-preset-4h");
    expect(el("quick-mute-confirm-24h")).toBeNull();
    await click("quick-mute-preset-24h");
    await click("o-dialog-primary-btn");
    expect(vi.mocked(alerts.muteAlert).mock.calls[0][2]).toMatchObject({ minutes: 1440 });
  });

  describe("the end hint under the presets", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 22, 14, 7));
    });
    afterEach(() => vi.useRealTimers());

    it("names the 24 h end as a time tomorrow, not a duration (MK-4)", async () => {
      await mountDialog(single);
      await click("quick-mute-preset-24h");
      expect(el("quick-mute-ends-in")?.textContent?.trim()).toBe("Until 2:07 PM tomorrow.");
    });

    it("keeps the duration for a preset that ends today", async () => {
      await mountDialog(single);
      await click("quick-mute-preset-30m");
      expect(el("quick-mute-ends-in")?.textContent?.trim()).toBe("In 30 min.");
    });
  });

  it("switches the 24 h confirm to Until it clears on request", async () => {
    await mountDialog(single);
    await click("quick-mute-preset-24h");
    await click("o-dialog-secondary-btn");
    expect(vi.mocked(alerts.muteAlert).mock.calls[0][2]).toMatchObject({ until_clear: true });
  });

  it("mutes only the group it was opened from, with that group's firing", async () => {
    await mountDialog(grouped);
    expect(el("quick-mute-groups-this")?.getAttribute("data-state")).toBe("on");
    expect(el("quick-mute-groups")?.textContent).toContain("cluster=prod-eu");
    await click("o-dialog-primary-btn");
    expect(vi.mocked(alerts.muteAlert).mock.calls[0][2]).toEqual({
      until_clear: true,
      group_keys: ["k-eu"],
      firing_started_at: 1_786_500_000_000_000,
      folder_id: "payments",
    });
  });

  it("mutes every group when All groups is picked", async () => {
    await mountDialog(grouped);
    await click("quick-mute-groups-all");
    expect(el("quick-mute-group-select")).toBeNull();
    await click("o-dialog-primary-btn");
    expect(vi.mocked(alerts.muteAlert).mock.calls[0][2]).toEqual({
      until_clear: true,
      all_groups: true,
      folder_id: "payments",
    });
  });

  it("still lets an on-call responder mute when no downtime folder is open to them", async () => {
    await mountDialog(single, []);
    expect(el("quick-mute-no-folder")).toBeNull();
    expect((el("o-dialog-primary-btn") as HTMLButtonElement).disabled).toBe(false);
    await click("o-dialog-primary-btn");
    expect(vi.mocked(alerts.muteAlert).mock.calls[0][2]).toEqual({ until_clear: true });
  });

  it("lets a responder with no folder mute an alert handed in after mount, as the list does", async () => {
    await mountDialog(null, []);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ alert: single, open: true });
    await flushPromises();
    await click("o-dialog-primary-btn");
    expect(vi.mocked(alerts.muteAlert).mock.calls[0][2]).toEqual({ until_clear: true });
  });

  it("names who is on call when the mute is refused, and stays open", async () => {
    vi.mocked(alerts.muteAlert).mockRejectedValue({
      response: {
        status: 403,
        data: {
          code: "mute_refused",
          message: "refused",
          rule: "role",
          on_call: [{ email: "kim@acme.io", name: "Kim", team: "payments" }],
          can_act: [],
        },
      },
    });
    await mountDialog(single);
    await click("o-dialog-primary-btn");
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "On call: Kim" }),
    );
    expect(wrapper.emitted("muted")).toBeUndefined();
  });

  it("keeps the shared list, 1 h default and no Groups field for a bulk mute", async () => {
    await mountDialog(null);
    expect(presetKeys()).not.toContain("quick-mute-preset-untilClear");
    expect(el("quick-mute-preset-1h")?.getAttribute("data-state")).toBe("on");
    expect(el("quick-mute-groups")).toBeNull();
  });
});
