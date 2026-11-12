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
import "@/locales";
import { gt } from "@/types/i18n";
import type { AutoObserveIncidentItem } from "@/services/autoobserve";
import type { IncidentAlert, IncidentEvent } from "@/services/incidents";
import {
  TIMELINE_CAP,
  issueComparisonMissing,
  issueComparisonNote,
  issueComparisonRows,
  issueLogsEndMs,
  issueSparkPoints,
  issueEndUs,
  issueMeta,
  issueSparkMarkers,
  issueStreams,
  issueTimeline,
  issueUnfoldCards,
  UNFOLD_STREAM_CAP,
  unfoldCardStream,
} from "./issueModel";
import { toIssueSeries } from "./issueSeries";

const zone = { locale: "en-US", timeZone: "UTC" };
const T0 = Date.UTC(2026, 10, 10, 16, 45);
const MIN_US = 60_000_000;
const us = T0 * 1000;

const member = (name: string, offsetMin = 0, backMin: number | null = null) => ({
  id: `f-${name}`,
  title: `${name} (logs) stopped sending data`,
  stream_type: "logs",
  stream_name: name,
  first_seen_at: us + offsetMin * MIN_US,
  recovered_at: backMin === null ? null : us + backMin * MIN_US,
});

const item = (over: Partial<AutoObserveIncidentItem> = {}): AutoObserveIncidentItem => ({
  finding: {
    id: "f1",
    kind: "stream_silence",
    stream_type: "logs",
    stream_name: "pay_api",
    first_seen_at: us,
  },
  incident: {
    id: "V5wPnqa6c0qfMLxGTdrwcF68Xq8",
    status: "open",
    severity: "P2",
    title: "pay_api (logs) stopped sending data",
    created_at: us + MIN_US,
  },
  investigation: { run_id: null, state: null, outcome: null, summary: null, not_run_reason: null },
  ...over,
});

const event = (type: string, atMin: number, user?: string): IncidentEvent => ({
  type,
  timestamp: us + atMin * MIN_US,
  data: user ? { user_id: user } : {},
});

describe("issueStreams", () => {
  it("lists the lead first and every other member once", () => {
    const streams = issueStreams(
      item({ members: [member("pay_api", 0, 30), member("a", 2), member("a", 3), member("b", 5)] }),
    );
    expect(streams.map((s) => [s.name, s.lead, s.recoveredUs])).toEqual([
      ["pay_api", true, us + 30 * MIN_US],
      ["a", false, null],
      ["b", false, null],
    ]);
  });

  it("an unreadable finding has no streams", () => {
    const bad = item();
    bad.finding.stream_name = null;
    expect(issueStreams(bad)).toEqual([]);
  });
});

describe("issueMeta", () => {
  it("an open incident runs to now with its duration so far", () => {
    expect(issueMeta(gt, zone, item(), T0 + 25 * 60_000)).toEqual(["4:45 PM → now", "25 minutes"]);
  });

  it("a group whose streams are all back ends at the last return and counts its streams", () => {
    const grouped = item({
      incident: { ...item().incident, status: "resolved" },
      members: [member("pay_api", 0, 20), member("b", 1, 40)],
    });
    expect(issueEndUs(grouped)).toBe(us + 40 * MIN_US);
    expect(issueMeta(gt, zone, grouped, T0 + 86_400_000)).toEqual([
      "4:45 PM → 5:25 PM",
      "40 minutes",
      "2 streams → 1 incident",
    ]);
  });

  it("a resolved incident with no recorded return shows only its start", () => {
    const done = item({ incident: { ...item().incident, status: "resolved" } });
    expect(issueMeta(gt, zone, done, T0 + 86_400_000)).toEqual(["4:45 PM"]);
  });
});

describe("issueTimeline", () => {
  it("names the server's own account AutoObserve, never its address", () => {
    const view = issueTimeline(gt, zone, item(), [event("Resolved", 9, "system@openobserve.ai")]);
    const resolved = view.entries.find((e) => String(e.title) === "Resolved");
    expect(String(resolved?.detail)).toBe("by AutoObserve");
  });

  it("orders what AutoObserve saw with the incident's events and ends with Still open", () => {
    const view = issueTimeline(gt, zone, item(), [
      event("Acknowledged", 10, "ana"),
      event("Created", 1),
      event("Comment", 12, "bo"),
    ]);
    expect(view.entries.map((e) => `${e.at} ${e.title}`)).toEqual([
      "4:45 PM AutoObserve noticed it",
      "4:46 PM Incident opened",
      "4:55 PM Acknowledged",
      "Now Still open",
    ]);
    expect(view.entries[2].detail).toBe("by ana");
    expect(view.more).toBe(0);
  });

  it("many streams read as one line, never one per stream", () => {
    const many = item({
      members: [member("pay_api"), ...["a", "b", "c", "d", "e"].map((n, i) => member(n, i + 1))],
    });
    const titles = issueTimeline(gt, zone, many, []).entries.map((e) => e.title);
    expect(titles).toContain("5 more streams affected");
    expect(titles.some((t) => t.startsWith("Also affected"))).toBe(false);
  });

  it("a few streams each get their own line", () => {
    const few = item({ members: [member("pay_api"), member("a", 1), member("b", 2, 9)] });
    const titles = issueTimeline(gt, zone, few, []).entries.map((e) => e.title);
    expect(titles).toEqual([
      "AutoObserve noticed it",
      "Also affected: a",
      "Also affected: b",
      "Sending again: b",
      "Still open",
    ]);
  });

  it("caps the list and says how many more wait in Activity", () => {
    const events = Array.from({ length: 12 }, (_, i) => event("Acknowledged", i + 2));
    const view = issueTimeline(gt, zone, item(), events);
    expect(view.entries).toHaveLength(TIMELINE_CAP);
    expect(view.more).toBe(1 + 12 + 1 - TIMELINE_CAP);
  });
});

describe("issueUnfoldCards", () => {
  const trigger = (
    id: string,
    kind: IncidentAlert["alert_kind"],
    atMin: number,
  ): IncidentAlert => ({
    incident_id: "i",
    alert_id: id,
    alert_name: `alert ${id}`,
    alert_kind: kind,
    alert_fired_at: us + atMin * MIN_US,
    correlation_reason: "service_discovery",
    created_at: us,
  });

  it("draws the first streams up to the cap, so the team lane stays in view", () => {
    const names = Array.from({ length: UNFOLD_STREAM_CAP + 3 }, (_, i) => `s${i}`);
    const cards = issueUnfoldCards(
      gt,
      zone,
      item({ members: names.map((n) => member(n)) }),
      [],
      [],
      null,
    );
    expect(cards.filter((c) => c.id.startsWith("stream:"))).toHaveLength(UNFOLD_STREAM_CAP);
  });

  it("builds one lane per stream, the team lane for paging and events, and no faked lanes", () => {
    const cards = issueUnfoldCards(
      gt,
      zone,
      item({
        members: [member("pay_api", 0, 30), member("b", 2)],
        page: { outcome: "paged", team_id: "t", team_name: "Payments" },
      }),
      [trigger("ao", "autoobserve", 0), trigger("x", "internal", 3), trigger("x", "internal", 4)],
      [event("Acknowledged", 6, "ana"), event("Comment", 7)],
      null,
    );
    expect(cards.map((c) => [c.id, c.lane])).toEqual([
      ["stream:logs/pay_api", "pay_api"],
      ["page", null],
      ["stream:logs/b", "b"],
      ["alert:x", "pay_api"],
      ["event:Acknowledged:" + (us + 6 * MIN_US), null],
      ["back:logs/pay_api", "pay_api"],
    ]);
    expect(cards.find((c) => c.id === "alert:x")).toMatchObject({ count: 2, kind: "metric" });
    expect(cards.find((c) => c.id === "page")).toMatchObject({
      outcome: "paged",
      title: "Incident opened",
      detail: "Paged Payments",
      after: "stream:logs/pay_api",
    });
    expect(cards.find((c) => c.id === "back:logs/pay_api")).toMatchObject({
      detail: "logs stream",
      lane: "pay_api",
    });
    expect(cards.some((c) => c.kind === "forecast" || c.kind === "change")).toBe(false);
  });

  it("puts the analysis's suspected change first, tagged as the likely cause", () => {
    const cards = issueUnfoldCards(gt, zone, item(), [], [], {
      kind: "config_change",
      reference: "cache.size 10% → 60%",
      occurred_at: us - 11 * MIN_US,
      shown_state: "confirmed",
    });
    expect(cards[0]).toMatchObject({
      kind: "change",
      title: "cache.size 10% → 60%",
      tag: "autoobserve.unfold.likelyCause",
      lane: "pay_api",
    });
  });

  it("an unpaged, unreadable incident has no cards", () => {
    const bad = item();
    bad.finding.stream_name = null;
    expect(issueUnfoldCards(gt, zone, bad, [], [], null)).toEqual([]);
  });

  it("a card reads its own stream's chart, and team cards read the lead's", () => {
    const streams = issueStreams(item({ members: [member("pay_api"), member("b", 1)] }));
    expect(unfoldCardStream({ id: "back:logs/b" } as never, streams)?.name).toBe("b");
    expect(unfoldCardStream({ id: "page" } as never, streams)?.name).toBe("pay_api");
  });
});

describe("chart and comparison", () => {
  const at = (ms: number) => new Date(ms).toISOString().slice(0, 19);
  const w = { startMs: T0 - 2 * 900_000, endMs: T0 + 4 * 900_000, detectedMs: T0, fixed: false };
  const series = toIssueSeries(
    [
      { t: at(T0 - 2 * 900_000), n: 1200 },
      { t: at(T0 - 900_000), n: 800 },
      { t: at(T0 + 900_000), n: 600 },
      { t: at(T0 + 2 * 900_000), n: 400 },
      { t: at(T0 + 3 * 900_000), n: 500 },
    ],
    w,
  );
  const open = {
    type: "logs",
    name: "pay_api",
    firstSeenUs: T0 * 1000,
    recoveredUs: null,
    lead: true,
  };
  const back = { ...open, recoveredUs: (T0 + 900_000) * 1000 };

  it("marks detection, each return, and the live edge only while the window ends now", () => {
    const [lead] = issueStreams(item({ members: [member("pay_api", 0, 20)] }));
    const marks = (s: typeof series) =>
      issueSparkMarkers(gt, zone, s, lead, true).map((m) => [m.kind, m.label]);
    expect(marks(series)).toEqual([
      ["detected", "Detected at 4:45 PM"],
      ["recovered", "Sending again at 5:05 PM"],
      ["live", "Still open"],
    ]);
    expect(marks({ ...series, endsNow: false }).map(([kind]) => kind)).toEqual([
      "detected",
      "recovered",
    ]);
    expect(marks({ ...series, startMs: T0 + 900_000 }).map(([kind]) => kind)).not.toContain(
      "detected",
    );
  });

  it.each([
    [
      "an open stream: before and since it started",
      open,
      null,
      null,
      [
        ["pay_api, before", "1,000", "healthy"],
        ["pay_api, since it started", "375", "affected"],
      ],
    ],
    [
      "a stream back once the incident ended: healthy only after the end",
      back,
      null,
      (T0 + 900_000) * 1000,
      [
        ["pay_api, before", "1,000", "healthy"],
        ["pay_api, while it was out", "0", "affected"],
        ["pay_api, after the incident ended", "450", "healthy"],
      ],
    ],
    [
      "the engine's usual level replaces the before bar",
      back,
      {
        expected: [0, 1, 2, 3].map((i) => ({ t: T0 + i * 900_000, v: 900 })),
        band: [],
        outside: [],
      },
      null,
      [
        ["pay_api, usual level", "900", "healthy"],
        ["pay_api, while it was out", "0", "affected"],
      ],
    ],
  ])("compares %s", (_name, stream, baseline, endUs, expected) => {
    const rows = issueComparisonRows(gt, "en-US", [{ stream, series, baseline }], endUs);
    expect(rows.map((r) => [r.label, r.shown, r.kind])).toEqual(expected);
  });

  it("a stream with no stored row before it started has no before bar and is named once", () => {
    const late = toIssueSeries([{ t: at(T0 + 900_000), n: 600 }], w);
    expect(late.usual).toBeNull();
    expect(issueSparkPoints(late).map((p) => p.v)).toEqual([null, null, 0, 600, 0, 0]);
    const pairs = [
      { stream: { ...open, name: "a" }, series: late },
      { stream: { ...open, name: "b" }, series: late },
      { stream: { ...open, name: "c" }, series },
    ];
    expect(
      issueComparisonRows(gt, "en-US", [{ stream: open, series: late }], null).map((r) => r.label),
    ).toEqual(["pay_api, since it started"]);
    const note = String(issueComparisonNote(gt, "en-US", pairs));
    expect(note).toContain("a and b");
    expect(note).not.toMatch(/\bc\b/);
    expect(issueComparisonNote(gt, "en-US", [pairs[2]])).toBeNull();
  });

  it("names failed and denied streams once each, so missing bars never pass for complete", () => {
    const note = String(issueComparisonMissing(gt, "en-US", ["a", "b"], ["c"]));
    expect(note).toContain("a and b");
    expect(note.match(/\bc\b/g)).toHaveLength(1);
    expect(issueComparisonMissing(gt, "en-US", [], [])).toBeNull();
    expect(String(issueComparisonMissing(gt, "en-US", [], [], true))).toContain("usual level");
  });

  it("ends the logs window an hour after the end, never past now, and at now while open", () => {
    const end = T0 * 1000;
    expect(issueLogsEndMs(null, T0 + 5)).toBe(T0 + 5);
    expect(issueLogsEndMs(end, T0 + 2 * 3_600_000)).toBe(T0 + 3_600_000);
    expect(issueLogsEndMs(end, T0 + 60_000)).toBe(T0 + 60_000);
  });
});
