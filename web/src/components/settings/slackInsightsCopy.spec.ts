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
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  classifySaveFailure,
  digestCounts,
  digestWhen,
  editSummary,
  moveLine,
  removedLine,
  todayCountsSentence,
  type InsightsFormValues,
} from "./slackInsightsCopy";

const t = i18n.global.t as unknown as TranslateFn;
const NY = "America/New_York";
const NOW = Date.UTC(2026, 10, 9, 16, 0);
const at = (iso: string) => Date.parse(iso) * 1000;
const error = (status?: number, code?: string) =>
  status === undefined
    ? new Error("Network Error")
    : Object.assign(new Error("x"), { response: { status, data: { code } } });

const saved: InsightsFormValues = {
  installation_id: "inst-1",
  channel_id: "C100",
  digest_time: "09:00",
  digest_time_zone: NY,
  post_trial_findings: false,
  allow_changes_from_slack: false,
};

describe("slackInsightsCopy", () => {
  it("says today for a digest on the reader's day in the digest zone, else the date", () => {
    expect(digestWhen(t, "en-US", at("2026-11-09T14:00:00Z"), NY, NOW)).toBe("today 09:00");
    expect(digestWhen(t, "en-US", at("2026-11-08T14:00:00Z"), NY, NOW)).toBe("Nov 8 09:00");
  });

  it("counts the calibration findings the digest posted, when the server sends them", () => {
    expect(
      digestCounts(t, "en-US", {
        needs_attention: 0,
        suggestions: 21,
        calibration_runs: 1,
        calibration_findings: 2,
      }),
    ).toBe("21 suggestions, 2 calibration findings");
  });

  it("lists only the digest counts above zero, with plurals", () => {
    expect(
      digestCounts(t, "en-US", { needs_attention: 1, suggestions: 0, calibration_runs: 2 }),
    ).toBe("1 needs attention, 2 calibration runs");
    expect(
      digestCounts(t, "en-US", { needs_attention: 0, suggestions: 0, calibration_runs: 0 }),
    ).toBe("");
  });

  it("drops today's counts at zero and marks a capped count as a floor", () => {
    expect(todayCountsSentence(t, null, "demo-org")).toBeNull();
    expect(
      todayCountsSentence(t, { attention: 0, attentionAtLeast: false, suggestions: 0 }, "demo-org"),
    ).toBeNull();
    expect(
      todayCountsSentence(t, { attention: 1, attentionAtLeast: false, suggestions: 1 }, "demo-org"),
    ).toBe("AutoObserve has 1 thing that needs attention and 1 suggestion in demo-org today.");
    expect(
      todayCountsSentence(
        t,
        { attention: 50, attentionAtLeast: true, suggestions: 30 },
        "demo-org",
      ),
    ).toBe("AutoObserve has 50+ things that need attention and 30 suggestions in demo-org today.");
  });

  it("names the one other workspace, and says another workspace for several", () => {
    expect(moveLine(t, ["eu"])).toContain("Picking a channel in eu moves the posts there.");
    expect(moveLine(t, ["eu", "apac"])).toContain(
      "Picking a channel in another workspace moves the posts there.",
    );
  });

  it("leaves the count out of the app-removed line when it is unknown", () => {
    expect(removedLine(t, "demo-workspace", null)).toContain("so today's digest wasn't sent.");
    expect(
      removedLine(t, "demo-workspace", { attention: 2, attentionAtLeast: false, suggestions: 0 }),
    ).toContain("so today's digest (2 need attention) wasn't sent.");
  });

  it("summarises each changed field once, in form order", () => {
    expect(editSummary(t, saved, saved, "ops-insights")).toEqual([]);
    expect(
      editSummary(
        t,
        saved,
        { ...saved, channel_id: null, allow_changes_from_slack: true, digest_time: "10:30" },
        "",
      ),
    ).toEqual([
      "Channel → No channel",
      "Digest time → 10:30 America/New_York",
      "Changes from Slack → On",
    ]);
  });

  it("classifies a failed save by what the reader has to do", () => {
    expect(classifySaveFailure(error())).toBe("noAnswer");
    expect(classifySaveFailure(error(503))).toBe("noAnswer");
    expect(classifySaveFailure(error(409))).toBe("stale");
    expect(classifySaveFailure(error(400, "not_in_channel"))).toBe("notInChannel");
    expect(classifySaveFailure(error(403))).toBe("forbidden");
    expect(classifySaveFailure(error(500))).toBe("other");
  });
});
