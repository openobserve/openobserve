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

import { describe, expect, it } from "vitest";
import type { Downtime } from "@/services/downtimes";
import type { TranslateFn } from "@/types/i18n";
import {
  QUICK_MUTE_PRESETS,
  SYSTEM_ACTOR,
  buildAlertMuteRequest,
  endTimeText,
  endedOnClear,
  groupOptionLabel,
  isQuickMute,
  presetSeconds,
} from "./quickMute";

describe("endTimeText", () => {
  const t = ((key: string, named?: Record<string, unknown>) =>
    key === "toastMessages.downtimes.timeTomorrow"
      ? `${named?.time} tomorrow`
      : key) as TranslateFn;
  const now = Date.UTC(2026, 9, 22, 14, 7) * 1000;
  const hours = (n: number) => now + n * 3_600_000_000;

  it("keeps a bare time for an end later today", () => {
    expect(endTimeText(hours(2), now, "UTC", t)).toBe("4:07 PM");
  });

  it("says tomorrow for the 24 h safety end", () => {
    expect(endTimeText(hours(24), now, "UTC", t)).toBe("2:07 PM tomorrow");
  });

  it("gives the date for an end after tomorrow", () => {
    expect(endTimeText(hours(72), now, "UTC", t)).toContain("Oct 25, 2026");
  });
});

describe("the shared quick mute presets", () => {
  it("are 30 min, 1 h, 4 h and 24 h, with no 2 h", () => {
    expect(QUICK_MUTE_PRESETS.map((p) => [p.key, p.secs])).toEqual([
      ["30m", 1800],
      ["1h", 3600],
      ["4h", 14400],
      ["24h", 86400],
    ]);
    expect(QUICK_MUTE_PRESETS.map((p) => p.labelKey)).not.toContain(
      "alerts.downtimes.mute.presets.2h",
    );
  });

  it("fit the 24 h ceiling every Slack mute and on-call snooze shares", () => {
    expect(Math.max(...QUICK_MUTE_PRESETS.map((p) => p.secs))).toBe(24 * 3600);
    expect(presetSeconds("24h")).toBe(86400);
  });
});

describe("the alert mute body", () => {
  it("asks for until it clears and nothing else when the user picked it", () => {
    expect(buildAlertMuteRequest({ untilClear: true })).toEqual({ until_clear: true });
  });

  it("sends a preset as whole minutes", () => {
    expect(buildAlertMuteRequest({ minutes: 60 })).toEqual({ minutes: 60 });
  });

  it("sends a custom end as microseconds", () => {
    expect(buildAlertMuteRequest({ endsAt: 1_790_000_000_000_000 })).toEqual({
      ends_at: 1_790_000_000_000_000,
    });
  });

  it("names the groups to mute", () => {
    expect(buildAlertMuteRequest({ untilClear: true, groups: ["k1", "k2"] })).toEqual({
      until_clear: true,
      group_keys: ["k1", "k2"],
    });
  });

  it("sends all groups without a group list", () => {
    expect(buildAlertMuteRequest({ minutes: 30, groups: ["k1"], allGroups: true })).toEqual({
      minutes: 30,
      all_groups: true,
    });
  });

  it("sends no empty group list", () => {
    expect(buildAlertMuteRequest({ minutes: 30, groups: [] })).toEqual({ minutes: 30 });
  });

  it("carries the firing, a trimmed reason and the folder to file the downtime in", () => {
    expect(
      buildAlertMuteRequest({
        minutes: 240,
        firingStartedAt: 1_790_000_000_000_000,
        reason: "  Working INC-482 ",
        folderId: "payments",
      }),
    ).toEqual({
      minutes: 240,
      firing_started_at: 1_790_000_000_000_000,
      reason: "Working INC-482",
      folder_id: "payments",
    });
  });

  it("drops a blank reason", () => {
    expect(buildAlertMuteRequest({ minutes: 30, reason: "   " })).toEqual({ minutes: 30 });
  });
});

const downtime = (over: Partial<Downtime> = {}): Downtime => ({
  id: "d1",
  org: "default",
  folder_id: "default",
  name: "Quick mute · checkout-error-rate",
  targets: [{ module: "alerts", folders: { kind: "all" }, ids: ["a1"] }],
  schedule: {
    repeat: "none",
    starts_at: 1,
    ends_at: 2,
    timezone: "UTC",
    duration_secs: 3600,
    weekdays: [],
  },
  show_banner: false,
  created_by: "bob@acme.io",
  created_at: 0,
  updated_by: "bob@acme.io",
  updated_at: 0,
  ...over,
});

describe("quick mute rows of the Downtimes list", () => {
  it("are one-time rows that name exactly one alert and nothing else", () => {
    expect(isQuickMute(downtime())).toBe(true);
  });

  it("exclude recurring rows, conditions, several ids and other modules", () => {
    const schedule = { ...downtime().schedule, repeat: "daily" as const };
    expect(isQuickMute(downtime({ schedule }))).toBe(false);
    expect(
      isQuickMute(downtime({ condition: { type: "pair", key: "k", operator: "=", value: "v" } })),
    ).toBe(false);
    expect(
      isQuickMute(
        downtime({ targets: [{ module: "alerts", folders: { kind: "all" }, ids: ["a1", "a2"] }] }),
      ),
    ).toBe(false);
    expect(
      isQuickMute(
        downtime({ targets: [{ module: "synthetics", folders: { kind: "all" }, ids: ["s1"] }] }),
      ),
    ).toBe(false);
  });

  it("ended on clear only when the system actor cancelled an until-it-clears row", () => {
    const untilClear = { alert_id: "a1", group_key: null };
    expect(endedOnClear(downtime({ end_on_clear: untilClear, cancelled_by: SYSTEM_ACTOR }))).toBe(
      true,
    );
    expect(endedOnClear(downtime({ end_on_clear: untilClear, cancelled_by: "bob@acme.io" }))).toBe(
      false,
    );
    expect(endedOnClear(downtime({ cancelled_by: SYSTEM_ACTOR }))).toBe(false);
    expect(SYSTEM_ACTOR).toBe("system@openobserve.ai");
  });
});

describe("a firing group as the Groups field shows it", () => {
  it("joins its label pairs", () => {
    expect(
      groupOptionLabel({
        key: "k",
        labels: [
          { name: "cluster", value: "prod-eu" },
          { name: "region", value: "eu-west-1" },
        ],
      }),
    ).toBe("cluster=prod-eu, region=eu-west-1");
  });

  it("falls back to the rendered labels, then the start of the key", () => {
    expect(groupOptionLabel({ key: "k", labelsText: "cluster=prod-eu" })).toBe("cluster=prod-eu");
    expect(groupOptionLabel({ key: "3f9a1c2e77d0" })).toBe("3f9a1c2e");
  });
});
