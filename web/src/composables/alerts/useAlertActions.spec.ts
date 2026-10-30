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

import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";
import alerts from "@/services/alerts";
import downtimes from "@/services/downtimes";
import { queryClient } from "@/composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useAlertActions } from "./useAlertActions";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/services/downtimes", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const store = createStore({
  state: {
    selectedOrganization: { identifier: "acme" },
    userInfo: { email: "me@acme.io" },
    timezone: "UTC",
  },
});

const mountActions = () => {
  let api: ReturnType<typeof useAlertActions> | undefined;
  mount(
    defineComponent({
      setup() {
        api = useAlertActions();
        return {};
      },
      template: "<div />",
    }),
    { global: { plugins: [store, i18n] } },
  );
  return api!;
};

const target = { alertId: "a1", name: "cpu-high", folderId: "ops" };
const ack = (who: string, group_key = "") => ({
  group_key,
  firing_started_at: 1,
  acked_by: who,
  acked_at: 1_786_500_000_000_000,
  ack_source: "slack" as const,
});
const httpError = (status: number, data: unknown) => ({ response: { status, data } });
const lastToast = () => vi.mocked(toast).mock.calls.at(-1)?.[0];

describe("useAlertActions", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(toast).mockReset();
    for (const fn of Object.values(alerts)) if (vi.isMockFunction(fn)) fn.mockReset();
    vi.mocked(downtimes.get).mockReset();
  });

  it("acknowledges one alert in the UI and confirms it", async () => {
    vi.mocked(alerts.ackAlert).mockResolvedValue({
      data: { changed: true, acks: [ack("me@acme.io")], other_groups_unacked: 0 },
    } as any);
    const ok = await mountActions().acknowledge(target);
    expect(ok).toBe(true);
    expect(alerts.ackAlert).toHaveBeenCalledWith("acme", "a1", { group_key: "" }, "ops");
    expect(lastToast()).toMatchObject({ variant: "success", message: "Acknowledged cpu-high" });
  });

  it("acknowledges every firing group of a multi-alert at once", async () => {
    vi.mocked(alerts.ackAlert).mockResolvedValue({
      data: {
        changed: true,
        acks: [ack("me@acme.io", "g1"), ack("me@acme.io", "g2")],
        other_groups_unacked: 0,
      },
    } as any);
    await mountActions().acknowledge(target, { allGroups: true });
    expect(alerts.ackAlert).toHaveBeenCalledWith("acme", "a1", { all_groups: true }, "ops");
    expect(lastToast()?.message).toBe("Acknowledged 2 groups of cpu-high");
  });

  it("sends the firing the screen showed, so a newer firing is never acked by mistake", async () => {
    vi.mocked(alerts.ackAlert).mockResolvedValue({
      data: { changed: true, acks: [ack("me@acme.io", "g1")], other_groups_unacked: 1 },
    } as any);
    await mountActions().acknowledge(target, { groupKey: "g1", firingStartedAt: 42 });
    expect(alerts.ackAlert).toHaveBeenCalledWith(
      "acme",
      "a1",
      { group_key: "g1", firing_started_at: 42 },
      "ops",
    );
  });

  it("says who already acknowledged when the click changed nothing", async () => {
    vi.mocked(alerts.ackAlert).mockResolvedValue({
      data: { changed: false, acks: [ack("carol@acme.io")], other_groups_unacked: 0 },
    } as any);
    await mountActions().acknowledge(target);
    expect(lastToast()).toMatchObject({
      variant: "info",
      message: "Already acknowledged by carol@acme.io",
    });
  });

  it("takes over someone else's acknowledgement", async () => {
    vi.mocked(alerts.ackAlert).mockResolvedValue({
      data: { changed: true, acks: [ack("me@acme.io")], other_groups_unacked: 0 },
    } as any);
    await mountActions().takeOver(target, { groupKey: "" });
    expect(alerts.ackAlert).toHaveBeenCalledWith(
      "acme",
      "a1",
      { group_key: "", take_over: true },
      "ops",
    );
    expect(lastToast()?.message).toBe("You took over the acknowledgement of cpu-high");
  });

  it("shows a refusal with who is on call and who can act", async () => {
    vi.mocked(alerts.ackAlert).mockRejectedValue(
      httpError(403, {
        code: "ack_refused",
        message: "refused",
        rule: "role",
        on_call: [{ email: "dana@acme.io", name: "Dana", team: "Payments" }],
        can_act: [{ email: "root@acme.io" }],
      }),
    );
    const ok = await mountActions().acknowledge(target);
    expect(ok).toBe(false);
    expect(lastToast()).toMatchObject({
      variant: "error",
      title: expect.stringContaining("You can't acknowledge this alert"),
      message: "On call: Dana. Can act: root@acme.io",
    });
  });

  it("explains a stale firing and a firing that ended", async () => {
    const api = mountActions();
    vi.mocked(alerts.ackAlert).mockRejectedValueOnce(
      httpError(409, { code: "firing_changed", firing_started_at: 9 }),
    );
    await api.acknowledge(target);
    expect(lastToast()?.message).toBe(
      "The alert fired again since this page loaded. Refresh and try again.",
    );
    vi.mocked(alerts.ackAlert).mockRejectedValueOnce(httpError(409, { code: "not_firing" }));
    await api.acknowledge(target);
    expect(lastToast()?.message).toBe(
      "This alert is not firing, so there is nothing to acknowledge.",
    );
  });

  it("unacknowledges one group", async () => {
    vi.mocked(alerts.unackAlert).mockResolvedValue({ data: { changed: true } } as any);
    await mountActions().unacknowledge(target, { groupKey: "g1" });
    expect(alerts.unackAlert).toHaveBeenCalledWith("acme", "a1", { group_key: "g1" }, "ops");
    expect(lastToast()?.message).toBe("Unacknowledged cpu-high");
  });

  it("mutes until it clears through the alert's own route", async () => {
    vi.mocked(alerts.muteAlert).mockResolvedValue({
      data: { downtime_id: "d1", version: 1, ends_at: 1_786_586_400_000_000 },
    } as any);
    const ok = await mountActions().mute(target, { untilClear: true });
    expect(ok).toBe(true);
    expect(alerts.muteAlert).toHaveBeenCalledWith("acme", "a1", { until_clear: true }, "ops");
    expect(lastToast()?.message).toEqual(expect.stringContaining("Muted cpu-high until it clears"));
  });

  describe("names the day of a mute end that is not today", () => {
    const NOW = Date.UTC(2026, 9, 22, 8, 37);
    const endIn = (hours: number) => (NOW + hours * 3_600_000) * 1000;
    const muteEndingAt = async (ends_at: number) => {
      vi.mocked(alerts.muteAlert).mockResolvedValue({
        data: { downtime_id: "d1", version: 1, ends_at },
      } as any);
      await mountActions().mute(target, { untilClear: true });
      return lastToast()?.message;
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it("says tomorrow for the 24 h end of Until it clears", async () => {
      expect(await muteEndingAt(endIn(24))).toBe(
        "Muted cpu-high until it clears, 8:37 AM tomorrow at the latest",
      );
    });

    it("keeps the bare time for an end later today", async () => {
      expect(await muteEndingAt(endIn(2))).toBe(
        "Muted cpu-high until it clears, 10:37 AM at the latest",
      );
    });

    it("gives the date for an end after tomorrow", async () => {
      expect(await muteEndingAt(endIn(72))).toEqual(expect.stringContaining("Oct 25, 2026"));
    });
  });

  it("mutes one group for a preset", async () => {
    vi.mocked(alerts.muteAlert).mockResolvedValue({
      data: { downtime_id: "d1", version: 1, ends_at: 1_786_586_400_000_000 },
    } as any);
    await mountActions().mute(target, { minutes: 30 }, { groups: ["g1"], firingStartedAt: 5 });
    expect(alerts.muteAlert).toHaveBeenCalledWith(
      "acme",
      "a1",
      { minutes: 30, group_keys: ["g1"], firing_started_at: 5 },
      "ops",
    );
    expect(lastToast()?.message).toEqual(expect.stringContaining("Muted cpu-high until"));
  });

  it("says when the alert is already muted", async () => {
    vi.mocked(alerts.muteAlert).mockRejectedValue(
      httpError(409, {
        code: "already_muted",
        downtime_id: "d1",
        version: 2,
        ends_at: 1_786_586_400_000_000,
      }),
    );
    expect(await mountActions().mute(target, { minutes: 60 })).toBe(false);
    expect(lastToast()?.message).toEqual(
      expect.stringContaining("cpu-high is already muted until"),
    );
  });

  it("extends with the version it holds", async () => {
    vi.mocked(alerts.extendAlertMute).mockResolvedValue({
      data: { version: 4, ends_at: 1_786_586_400_000_000 },
    } as any);
    await mountActions().extend(target, { id: "d1", ends_at: 1, version: 3 }, { minutes: 60 });
    expect(alerts.extendAlertMute).toHaveBeenCalledWith(
      "acme",
      "a1",
      "d1",
      { version: 3, minutes: 60 },
      "ops",
    );
    expect(lastToast()?.message).toEqual(expect.stringContaining("Extended until"));
  });

  it("reads the version first when the chip did not carry one", async () => {
    vi.mocked(downtimes.get).mockResolvedValue({ data: { id: "d1", version: 7 } } as any);
    vi.mocked(alerts.extendAlertMute).mockResolvedValue({
      data: { version: 8, ends_at: 1_786_586_400_000_000 },
    } as any);
    await mountActions().extend(target, { id: "d1", ends_at: 1 }, { untilClear: true });
    expect(alerts.extendAlertMute).toHaveBeenCalledWith(
      "acme",
      "a1",
      "d1",
      { version: 7, until_clear: true },
      "ops",
    );
  });

  it("shows the new end when the mute changed under the click", async () => {
    vi.mocked(alerts.extendAlertMute).mockRejectedValue(
      httpError(409, { code: "version_changed", version: 9, ends_at: 1_786_586_400_000_000 }),
    );
    await mountActions().extend(target, { id: "d1", ends_at: 1, version: 3 }, { minutes: 30 });
    expect(lastToast()?.message).toEqual(
      expect.stringContaining("This mute changed since the page loaded"),
    );
  });

  it("ends a quick mute, and points elsewhere for a downtime it does not own", async () => {
    const api = mountActions();
    vi.mocked(alerts.cancelAlertMute).mockResolvedValueOnce({ data: {} } as any);
    expect(await api.endMute(target, "d1")).toBe(true);
    expect(alerts.cancelAlertMute).toHaveBeenCalledWith("acme", "a1", "d1", "ops");
    expect(lastToast()?.message).toBe("Mute ended. Notifications resume.");

    vi.mocked(alerts.cancelAlertMute).mockRejectedValueOnce(
      httpError(409, { code: "not_a_quick_mute" }),
    );
    expect(await api.endMute(target, "d2")).toBe(false);
    expect(lastToast()?.message).toEqual(expect.stringContaining("Downtimes page"));
  });

  it("knows the signed-in user, for hiding Take over on one's own ack", () => {
    expect(mountActions().me.value).toBe("me@acme.io");
  });
});
