// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { gt } from "@/types/i18n";
import common from "@/services/common";
import downtimes from "@/services/downtimes";
import { queryClient } from "@/composables/query/queryClient";
import QuickMuteDialog from "./QuickMuteDialog.vue";
import {
  QUICK_MUTE_PRESETS,
  buildQuickMuteRequest,
  groupSelection,
  presetSeconds,
} from "@/utils/downtimes/quickMute";
import {
  makeQuickMuteSchema,
  quickMuteDefaults,
  quickMuteEndsAt,
  type QuickMuteForm,
} from "./QuickMuteDialog.schema";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/services/common", () => ({ default: { list_Folders: vi.fn() } }));
vi.mock("@/services/downtimes", () => ({ default: { quickMute: vi.fn(), create: vi.fn() } }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const NOW = Date.parse("2026-09-17T14:10:00Z") * 1000;

describe("quick mute request body", () => {
  it("sends one target with all folders and the ids, filed in default, with no banner", () => {
    const body = buildQuickMuteRequest(
      [{ module: "alerts", ids: ["a1", "a2"] }],
      NOW,
      NOW + presetSeconds("1h") * 1_000_000,
      "UTC",
      " Working INC-231 ",
    );
    expect(body).toEqual({
      folder_id: "default",
      reason: "Working INC-231",
      targets: [{ module: "alerts", folders: { kind: "all" }, ids: ["a1", "a2"] }],
      schedule: {
        repeat: "none",
        starts_at: NOW,
        ends_at: NOW + 3600 * 1_000_000,
        timezone: "UTC",
        duration_secs: 3600,
        weekdays: [],
      },
      show_banner: false,
    });
  });

  it("sends one target per module when alert and anomaly rows are muted together", () => {
    const rows = [
      { id: "a1", anomaly: false },
      { id: "ad_7c1", anomaly: true },
      { id: "a2", anomaly: false },
    ];
    const selection = groupSelection(
      rows,
      (r) => (r.anomaly ? "anomaly_detections" : "alerts"),
      (r) => r.id,
    );
    const body = buildQuickMuteRequest(selection, NOW, NOW + 1, "UTC");
    expect(body.targets).toEqual([
      { module: "alerts", folders: { kind: "all" }, ids: ["a1", "a2"] },
      { module: "anomaly_detections", folders: { kind: "all" }, ids: ["ad_7c1"] },
    ]);
    expect(body).not.toHaveProperty("reason");
  });

  it("files the mute in the folder the user picked", () => {
    const body = buildQuickMuteRequest(
      [{ module: "alerts", ids: ["a1"] }],
      NOW,
      NOW + 1,
      "UTC",
      undefined,
      "payments-maintenance",
    );
    expect(body.folder_id).toBe("payments-maintenance");
  });
});

describe("quick mute form", () => {
  const schema = makeQuickMuteSchema(
    gt,
    () => "UTC",
    () => NOW,
  );
  const values = (over: Partial<QuickMuteForm>): QuickMuteForm => ({
    preset: "custom",
    end_date: "2026-09-17",
    end_time: "18:00",
    reason: "",
    folder_id: "payments",
    ...over,
  });

  it("defaults to 1 h, with the custom end one hour out", () => {
    const defaults = quickMuteDefaults(NOW / 1000, "UTC", "payments");
    expect(defaults.preset).toBe("1h");
    expect([defaults.end_date, defaults.end_time]).toEqual(["2026-09-17", "15:10"]);
  });

  it("defaults to Until it clears for one alert, ending at the 24 h safety end", () => {
    const defaults = quickMuteDefaults(NOW / 1000, "UTC", "payments", "untilClear");
    expect(defaults.preset).toBe("untilClear");
    expect(quickMuteEndsAt(defaults, NOW, "UTC")).toBe(NOW + 86400 * 1_000_000);
    expect(schema.safeParse(values({ preset: "untilClear" })).success).toBe(true);
  });

  it("files an alert mute without a folder when none is open to the user", () => {
    const alertSchema = makeQuickMuteSchema(
      gt,
      () => "UTC",
      () => NOW,
      { folderOptional: () => true },
    );
    expect(alertSchema.safeParse(values({ preset: "1h", folder_id: "" })).success).toBe(true);
    expect(schema.safeParse(values({ preset: "1h", folder_id: "" })).success).toBe(false);
  });

  it("ends a preset at now plus its length", () => {
    expect(quickMuteEndsAt(values({ preset: "30m" }), NOW, "UTC")).toBe(NOW + 1800 * 1_000_000);
  });

  it("accepts a custom end in the future and refuses one in the past", () => {
    expect(schema.safeParse(values({})).success).toBe(true);
    const past = schema.safeParse(values({ end_time: "12:00" }));
    expect(past.success).toBe(false);
    expect(past.error?.issues[0].message).toBe("The end must be after the start.");
  });

  it("accepts exactly the offered presets and Custom", () => {
    for (const { key } of QUICK_MUTE_PRESETS) {
      expect(schema.safeParse(values({ preset: key })).success).toBe(true);
    }
    expect(schema.safeParse(values({ preset: "8h" as QuickMuteForm["preset"] })).success).toBe(
      false,
    );
  });

  it("refuses a custom end more than 7 days away", () => {
    const far = schema.safeParse(values({ end_date: "2026-09-30" }));
    expect(far.error?.issues[0].message).toBe("A window can last at most 7 days.");
  });
});

describe("quick mute with no folder to file in", () => {
  it("says so and disables Mute when the permitted folder list is empty", async () => {
    queryClient.clear();
    vi.mocked(common.list_Folders).mockResolvedValue({ data: { list: [] } } as never);
    const store = createStore({
      state: {
        timezone: "UTC",
        selectedOrganization: { identifier: "acme" },
        zoConfig: { downtimes_enabled: true },
      },
    });
    const wrapper = mount(QuickMuteDialog, {
      props: { open: false, selection: [{ module: "alerts", ids: ["a1"] }] },
      global: { plugins: [store] },
      attachTo: document.body,
    });
    await wrapper.setProps({ open: true });
    await flushPromises();
    await vi.waitFor(() =>
      expect(document.body.querySelector('[data-test="quick-mute-no-folder"]')).not.toBeNull(),
    );
    expect(document.body.textContent).toContain("No folder you can file a downtime in");
    const mute = document.body.querySelector<HTMLButtonElement>(
      '[data-test="o-dialog-primary-btn"]',
    );
    expect(mute?.disabled).toBe(true);
    expect(downtimes.create).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
