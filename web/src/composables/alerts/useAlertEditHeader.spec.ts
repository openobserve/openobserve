// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computed, defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useAlertEditHeader, type AlertEditHeader } from "./useAlertEditHeader";

const createMute = vi.fn();
const endMute = vi.fn();
const downtimesEnabled = ref(true);
let listRows: Record<string, unknown>[] = [];
const trigger = vi.fn();
const toastSpy = vi.fn();

vi.mock("@/composables/alerts/useAlertActions", () => ({
  useAlertActions: () => ({ createMute, endMute, pending: computed(() => false) }),
}));
vi.mock("@/composables/downtimes/useDowntimesEnabled", () => ({
  useDowntimesEnabled: () => computed(() => downtimesEnabled.value),
}));
vi.mock("@/composables/downtimes/useViewerTimezone", () => ({
  useViewerTimezone: () => computed(() => "UTC"),
}));
vi.mock("@/composables/query", () => ({ useOrgId: () => computed(() => "default") }));
vi.mock("@/services/alerts.queries", () => ({
  alertsListQuery: (org: string, folder: string, name: string) => ({
    queryKey: ["alerts-test", org, folder, name],
    queryFn: async () => listRows,
  }),
  toggleAlertStateMutation: () => ({
    mutationFn: async (vars: { enabled: boolean }) => ({ data: { enabled: vars.enabled } }),
  }),
}));
vi.mock("@/services/alerts", () => ({
  default: { trigger_alert: (...args: unknown[]) => trigger(...args) },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (o: unknown) => toastSpy(o) }));

const host = (onEnabledSaved?: (enabled: boolean) => void) => {
  let api: AlertEditHeader | null = null;
  mount(
    defineComponent({
      setup() {
        api = useAlertEditHeader({
          alertId: () => "a1",
          name: () => "errors",
          folderId: () => "f1",
          onEnabledSaved,
        });
        return () => h("div");
      },
    }),
  );
  return () => api!;
};

// 2026-10-30 14:00:00 UTC in microseconds.
const ENDS_AT = Date.UTC(2026, 9, 30, 14, 0, 0) * 1000;

describe("useAlertEditHeader", () => {
  beforeEach(() => {
    createMute.mockReset();
    endMute.mockReset();
    trigger.mockReset();
    toastSpy.mockReset();
    downtimesEnabled.value = true;
    listRows = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ENDS_AT / 1000 - 3_600_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is not muted until a mute lands, then reads Muted until HH:MM", async () => {
    createMute.mockResolvedValue({ downtime_id: "dt1", version: 1, ends_at: ENDS_AT });
    const api = host();
    await flushPromises();
    expect(api().muted.value).toBeNull();
    expect(await api().muteFor(3600)).toBe(true);
    expect(createMute).toHaveBeenCalledWith(
      { alertId: "a1", name: "errors", folderId: "f1" },
      { minutes: 60 },
    );
    expect(api().muted.value).toEqual({ id: "dt1", ends_at: ENDS_AT, version: 1 });
    expect(api().mutedUntilText.value).toBe("Muted until 14:00");
  });

  it("lets a list read that started after a local mute decide again", async () => {
    createMute.mockResolvedValue({ downtime_id: "dt1", version: 1, ends_at: ENDS_AT });
    const api = host();
    await flushPromises();
    await api().muteFor(3600);
    expect(api().muted.value?.id).toBe("dt1");
    listRows = [{ alert_id: "a1", enabled: true, active_downtime: null }];
    api().refresh();
    await flushPromises();
    expect(api().muted.value).toBeNull();
  });

  it("stops reading Muted once the mute's end time passes", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(ENDS_AT / 1000 - 60_000);
    createMute.mockResolvedValue({ downtime_id: "dt1", version: 1, ends_at: ENDS_AT });
    const api = host();
    await api().muteFor(60);
    expect(api().muted.value?.id).toBe("dt1");
    vi.advanceTimersByTime(61_000);
    expect(api().muted.value).toBeNull();
    expect(api().mutedUntilText.value).toBe("");
  });

  it("Unmute cancels the mute through the alert route and clears the state", async () => {
    createMute.mockResolvedValue({ downtime_id: "dt1", version: 1, ends_at: ENDS_AT });
    endMute.mockResolvedValue(true);
    const api = host();
    await api().muteFor(3600);
    expect(await api().unmute()).toBe(true);
    expect(endMute).toHaveBeenCalledWith({ alertId: "a1", name: "errors", folderId: "f1" }, "dt1");
    expect(api().muted.value).toBeNull();
  });

  it("stays unmuted when the mute is refused", async () => {
    createMute.mockResolvedValue(null);
    const api = host();
    expect(await api().muteFor(1800)).toBe(false);
    expect(api().muted.value).toBeNull();
  });

  it("reads an alert-wide mute and the last outcome from the list row", async () => {
    listRows = [
      {
        alert_id: "a1",
        enabled: true,
        last_outcome: "firing",
        active_downtime: { id: "dt9", ends_at: ENDS_AT, version: 2 },
      },
    ];
    const api = host();
    await flushPromises();
    expect(api().muted.value).toEqual({ id: "dt9", ends_at: ENDS_AT, version: 2 });
    expect(api().state.value).toEqual({ kind: "outcome", value: "firing" });
  });

  it("does not treat a group mute as muting the whole alert", async () => {
    listRows = [
      {
        alert_id: "a1",
        enabled: true,
        active_downtime: { id: "dt9", ends_at: ENDS_AT, alert_groups: [{ key: "g" }] },
      },
    ];
    const api = host();
    await flushPromises();
    expect(api().muted.value).toBeNull();
  });

  it("chips a disabled alert as disabled whatever it last did", async () => {
    listRows = [{ alert_id: "a1", enabled: false, last_outcome: "firing" }];
    const api = host();
    await flushPromises();
    expect(api().state.value).toEqual({ kind: "disabled" });
  });

  it("exposes the downtimes gate", () => {
    downtimesEnabled.value = false;
    const api = host();
    expect(api().muteEnabled.value).toBe(false);
  });

  it("fires through the trigger call and says when nothing ran", async () => {
    trigger.mockResolvedValue({ data: { ineligible: true, message: "not eligible" } });
    const api = host();
    await api().fireNow();
    expect(trigger).toHaveBeenCalledWith("default", "a1", "f1");
    expect(toastSpy).toHaveBeenCalledWith({ variant: "warning", message: "not eligible" });
  });

  it("toggles enabled through the state mutation", async () => {
    listRows = [{ alert_id: "a1", enabled: true }];
    const api = host();
    await flushPromises();
    await api().toggleEnabled();
    expect(api().enabled.value).toBe(false);
  });

  it("hands the saved state to the form so a later save keeps it", async () => {
    listRows = [{ alert_id: "a1", enabled: true }];
    const onEnabledSaved = vi.fn();
    const api = host(onEnabledSaved);
    await flushPromises();
    await api().toggleEnabled();
    expect(onEnabledSaved).toHaveBeenCalledWith(false);
    expect(api().state.value).toEqual({ kind: "disabled" });
    await api().toggleEnabled();
    expect(onEnabledSaved).toHaveBeenLastCalledWith(true);
  });
});
