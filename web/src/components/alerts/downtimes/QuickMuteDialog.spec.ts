// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { gt } from "@/types/i18n";
import { buildQuickMuteRequest, groupSelection, presetSeconds } from "@/utils/downtimes/quickMute";
import { makeQuickMuteSchema, quickMuteEndsAt, type QuickMuteForm } from "./QuickMuteDialog.schema";

const NOW = Date.parse("2026-09-17T14:10:00Z") * 1000;

describe("quick mute request body", () => {
  it("sends one target with all folders and the ids, filed in default, with no banner", () => {
    const body = buildQuickMuteRequest(
      [{ module: "alerts", ids: ["a1", "a2"] }],
      NOW,
      NOW + presetSeconds("2h") * 1_000_000,
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
        ends_at: NOW + 7200 * 1_000_000,
        timezone: "UTC",
        duration_secs: 7200,
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
});

describe("quick mute form", () => {
  const schema = makeQuickMuteSchema(gt, "UTC", () => NOW);
  const values = (over: Partial<QuickMuteForm>): QuickMuteForm => ({
    preset: "custom",
    end_date: "2026-09-17",
    end_time: "18:00",
    reason: "",
    ...over,
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

  it("refuses a custom end more than 7 days away", () => {
    const far = schema.safeParse(values({ end_date: "2026-09-30" }));
    expect(far.error?.issues[0].message).toBe("A window can last at most 7 days.");
  });
});
