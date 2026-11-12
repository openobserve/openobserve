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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/locales";
import config from "@/aws-exports";
import { gt } from "@/types/i18n";
import type { AutoObserveCoverageRow, AutoObserveSuggestion } from "@/services/autoobserve";
import { insightOf, toRequests, toSuggestionRows } from "../live/liveAdapter";
import type { InsightCta, InsightParts } from "./insightCopy";

const NOW_MS = Date.UTC(2026, 10, 9, 12, 0);
const HOUR_US = 3_600_000_000;
const zone = { locale: "en-US", timeZone: "UTC" };

const suggestion = (
  kind: string,
  evidence: Record<string, unknown> = {},
  over: Partial<AutoObserveSuggestion> = {},
): AutoObserveSuggestion => ({
  id: `${kind}-1`,
  org: "demo-org",
  analyzer: "coverage",
  kind,
  subject: { kind: "service", key_dims: { service_name: "svc-ingest-c" } },
  evidence: { service_name: "svc-ingest-c", ...evidence },
  score: 1,
  confidence: "sufficient",
  status: "proposed",
  decided_score: null,
  on_accept: null,
  ...over,
});

const NONE_CELLS = {
  errors: { state: "none", evidence: [], counts: {} },
  latency: { state: "none", evidence: [], counts: {} },
  absence: { state: "none", evidence: [], counts: {} },
};

const row = (streams: { type: string; name: string }[]): AutoObserveCoverageRow => ({
  service_id: "svc-ingest-c",
  service_name: "svc-ingest-c",
  cluster: null,
  namespace: null,
  streams,
  traffic_per_hour: 47,
  cells: NONE_CELLS as AutoObserveCoverageRow["cells"],
});

const gapCard = (rows: AutoObserveCoverageRow[] | undefined) =>
  insightOf(
    gt,
    zone,
    suggestion("coverage_gap", { cells: NONE_CELLS, traffic_per_hour: 47 }),
    NOW_MS,
    rows ? { rows } : undefined,
  );

const ctaKind = (cta: InsightCta | null) => cta?.target.type;

let enterprise: string;

beforeEach(() => {
  enterprise = config.isEnterprise;
  config.isEnterprise = "true";
});

afterEach(() => {
  config.isEnterprise = enterprise;
});

describe("coverage gap card (flagged surface 1)", () => {
  it("says why in plain words, with no raw state words or engine names", () => {
    const parts = gapCard([row([{ type: "logs", name: "ingest_c" }])]);
    expect(parts.headline).toBe("Nothing watches svc-ingest-c");
    expect(parts.chip.label).toBe("Coverage gap");
    expect(parts.why).toBe(
      "No alert watches its errors, its latency, or whether it stops sending. It handles about 47 events an hour.",
    );
    expect(`${parts.why} ${parts.next} ${parts.whyDetail ?? ""}`).not.toMatch(
      /None|engine|monitor|absence|Absence/,
    );
  });

  it("drafts errors, latency and no-data in one review list; the list measures their thresholds (F1)", () => {
    const parts = gapCard([
      row([
        { type: "logs", name: "ingest_c" },
        { type: "traces", name: "default" },
      ]),
    ]);
    expect(parts.next).toBe("Add the 3 alerts AutoObserve drafted.");
    expect(parts.cta?.label).toBe("Review and add alerts");
    const target = parts.cta?.target;
    if (target?.type !== "bulk") throw new Error("expected bulk");
    expect(target.request.rows.map((r) => [r.kind, r.scope.stream.name, r.usually])).toEqual([
      ["errors", "ingest_c", null],
      ["latency", "default", null],
      ["no_data", "ingest_c", null],
    ]);
  });

  it("carries the service's own alert ids, so the review can fill who they notify (W4)", () => {
    const ev = (id: string, kind = "alert") => ({
      monitor_kind: kind,
      monitor_id: id,
      monitor_name: id,
      predicate: "",
      last_data_at: null,
    });
    const owned = {
      ...row([
        { type: "logs", name: "ingest_c" },
        { type: "traces", name: "default" },
      ]),
      cells: {
        ...NONE_CELLS,
        errors: { state: "weak", evidence: [ev("al-2")], counts: {} },
        latency: {
          state: "none",
          evidence: [],
          counts: {},
          all_evidence: [
            { ...ev("al-1"), state: "blind" },
            { ...ev("syn-1", "synthetic"), state: "weak" },
          ],
        },
      },
    } as AutoObserveCoverageRow;
    const target = gapCard([owned]).cta?.target;
    if (target?.type !== "bulk") throw new Error("expected bulk");
    expect(target.request.rows.map((r) => r.alertIds)).toEqual([
      ["al-1", "al-2"],
      ["al-1", "al-2"],
      ["al-1", "al-2"],
    ]);
    const bare = gapCard([
      row([
        { type: "logs", name: "ingest_c" },
        { type: "traces", name: "t" },
      ]),
    ]);
    if (bare.cta?.target.type !== "bulk") throw new Error("expected bulk");
    expect(bare.cta.target.request.rows.every((r) => r.alertIds === undefined)).toBe(true);
  });

  it("says latency needs traces when the service sends none", () => {
    const parts = gapCard([row([{ type: "logs", name: "ingest_c" }])]);
    expect(parts.next).toBe("Add the 2 alerts AutoObserve drafted. Latency needs traces first.");
  });

  it("offers one Add alert when only one alert can be drafted", () => {
    const parts = insightOf(
      gt,
      zone,
      suggestion("coverage_gap", {
        cells: { ...NONE_CELLS, errors: { state: "covered", evidence: [], counts: {} } },
        traffic_per_hour: 47,
      }),
      NOW_MS,
      { rows: [row([{ type: "logs", name: "ingest_c" }])] },
    );
    expect(parts.cta?.label).toBe("Add alert");
    expect(parts.next).toBe("Add the alert AutoObserve drafted. Latency needs traces first.");
    const target = parts.cta?.target;
    if (target?.type !== "create_alert") throw new Error("expected create_alert");
    expect(target.prefill.sql).toContain('FROM "ingest_c"');
    expect(target.prefill.sql).toContain("HAVING count(*) = 0");
    expect(target.folder).toBe("default");
  });

  it("opens the service when its streams are not known yet", () => {
    const parts = gapCard(undefined);
    expect(parts.cta?.label).toBe("Open service");
    expect(ctaKind(parts.cta)).toBe("route");
  });

  it("asks AI for a draft only, naming the service and its volume", () => {
    const parts = gapCard([row([{ type: "logs", name: "ingest_c" }])]);
    expect(String(parts.ai?.request)).toBe(
      "Set up alerts for svc-ingest-c. It has no alert for errors, latency, or stopping. It sends about 47 events an hour to ingest_c. Draft the missing alerts scoped to this service, show them to me, and don't save until I say so.",
    );
    expect(parts.ai?.subject).toBe("svc-ingest-c");
  });

  it("shows no button at all on a build without enterprise", () => {
    config.isEnterprise = "false";
    const parts = gapCard([row([{ type: "logs", name: "ingest_c" }])]);
    expect(parts.cta).toBeNull();
    expect(parts.secondary).toEqual([]);
    expect(parts.ai).toBeNull();
  });
});

describe("no-data check", () => {
  it("drafts one no-data alert when nothing would notice", () => {
    const parts = insightOf(
      gt,
      zone,
      suggestion("no_absence_check", { cells: NONE_CELLS, traffic_per_hour: 47 }),
      NOW_MS,
      { rows: [row([{ type: "logs", name: "ingest_c" }])] },
    );
    expect(parts.chip.label).toBe("Missing alert");
    expect(parts.why).toBe(
      "Nothing alerts if svc-ingest-c stops sending. It usually sends about 47 events an hour.",
    );
    expect(parts.next).toBe(
      "Add a no-data alert: it fires when svc-ingest-c sends nothing for 15 minutes.",
    );
    expect(parts.cta?.label).toBe("Add alert");
    expect(parts.cta?.note).toBe(
      "Opens the alert form filled in. Nothing is saved until you save.",
    );
  });

  it("sends a silent check to its editor to choose who gets notified", () => {
    const parts = insightOf(
      gt,
      zone,
      suggestion("no_absence_check", {
        cells: {
          ...NONE_CELLS,
          absence: {
            state: "silent",
            evidence: [
              {
                monitor_kind: "alert",
                monitor_id: "a-9",
                monitor_name: "ingress-volume-detector",
                predicate: "",
              },
            ],
            counts: {},
          },
        },
      }),
      NOW_MS,
    );
    expect(parts.chip.label).toBe("Notifies no one");
    expect(parts.chip.tone).toBe("gap");
    expect(parts.why).toBe(
      "ingress-volume-detector would notice svc-ingest-c stopping, but it notifies no one.",
    );
    expect(parts.cta?.label).toBe("Choose who gets notified");
    const target = parts.cta?.target;
    expect(parts.cta?.target).toEqual({
      type: "destinations",
      alertId: "a-9",
      alertName: "ingress-volume-detector",
      destinations: [],
    });
  });

  it("sends a silent coverage alert to its destinations, not the generic editor", () => {
    const parts = insightOf(
      gt,
      zone,
      suggestion(
        "silent_coverage",
        { monitor_name: "checkout-health", classes: ["absence"], services: ["svc-a"] },
        {
          actions: [
            { type: "review_alert", alert_id: "a-7", focus: "settings" },
          ] as AutoObserveSuggestion["actions"],
        },
      ),
      NOW_MS,
    );
    expect(parts.cta?.label).toBe("Choose who gets notified");
    expect(parts.cta?.target).toEqual({
      type: "destinations",
      alertId: "a-7",
      alertName: "checkout-health",
      destinations: [],
    });
  });
});

describe("source silence (FU-SRC-UI): a real kind, not Other", () => {
  const SIGNAL = Date.UTC(2026, 10, 9, 0, 0) * 1000;
  const source = (count: number, over: Record<string, unknown> = {}) =>
    suggestion(
      "source_silence",
      {
        source_class: "cluster",
        source_field: "k8s_cluster_name",
        source_value: "cluster-d",
        stream_type: "logs",
        stream_name: "k8s_events",
        signal_at: SIGNAL,
        rows_per_day: 1300,
        state: "quiet",
        source_count: count,
        stream_count: count > 1 ? 2 : 1,
        back_count: 0,
        sources: Array.from({ length: Math.min(count, 4) }, (_, i) => ({
          source_field: "k8s_cluster_name",
          source_value: i ? `cluster-${i}` : "cluster-d",
          stream_type: "logs",
          stream_name: "k8s_events",
        })),
        ...over,
      },
      {
        analyzer: "source_silence",
        subject: { kind: "stream", key_dims: { stream_type: "logs", stream_name: "k8s_events" } },
        advice: "check_source_sender",
        actions: [
          {
            type: "inspect_source",
            stream_type: "logs",
            stream_name: "k8s_events",
            field: "k8s_cluster_name",
            value: "cluster-d",
            from: SIGNAL - 6 * HOUR_US,
          },
        ] as AutoObserveSuggestion["actions"],
      },
    );

  it("names the source, the stream and the usual volume", () => {
    const parts = insightOf(gt, zone, source(1), NOW_MS);
    expect(parts.chip.label).toBe("Stopped sending");
    expect(parts.headline).toBe("cluster-d stopped sending to k8s_events");
    expect(parts.why).toBe(
      "Since Nov 9, 2026, 12:00 AM. It usually sends about 1,300 rows a day; the rest of k8s_events kept flowing.",
    );
    expect(parts.next).toBe("Check the agent or collector on cluster-d.");
  });

  it("opens Logs from the server's inspect_source action and drafts one no-data alert", () => {
    const parts = insightOf(gt, zone, source(1), NOW_MS);
    expect(parts.cta?.label).toBe("Open in Logs");
    const to = (parts.cta?.target as { to: { query: Record<string, string> } }).to;
    expect(to.query.stream).toBe("k8s_events");
    expect(Number(to.query.from)).toBe(SIGNAL - 6 * HOUR_US);
    expect(parts.secondary.map((c) => c.label)).toEqual(["Add alert"]);
  });

  it("folds many sources into one line and reviews their alerts in one list", () => {
    const parts = insightOf(gt, zone, source(7), NOW_MS);
    expect(parts.why).toContain("And 6 more sources in 2 streams.");
    const review = parts.secondary.find((c) => c.action === "reviewAndAddAlerts");
    expect(review?.label).toBe("Review and add alerts");
    if (review?.target.type !== "bulk") throw new Error("expected bulk");
    expect(review.target.request.kind).toBe("source");
    expect(review.target.request.rows).toHaveLength(4);
  });

  it("says what to check once the source is back", () => {
    const parts = insightOf(gt, zone, source(1, { state: "came_back" }), NOW_MS);
    expect(parts.next).toBe("Check the agent or collector on cluster-d.");
    const back = insightOf(
      gt,
      zone,
      { ...source(1, { state: "came_back" }), advice: "see_source_gap" },
      NOW_MS,
    );
    expect(back.next).toBe("It's back. Check what the gap left out.");
  });
});

describe("heartbeat on success: Add alert straight from the server's create_alert", () => {
  const heartbeat = (
    schedule: { frequency_secs: number | null; cron?: string } = {
      frequency_secs: 3_600,
    },
  ) =>
    suggestion(
      "heartbeat_on_success",
      { anchor: "backup finished", present_days: 14, period_secs: 86_400 },
      {
        analyzer: "heartbeat",
        subject: {
          kind: "stream",
          key_dims: { stream_type: "logs", stream_name: "jobs", service_name: "nightly-backup" },
        },
        actions: [
          {
            type: "create_alert",
            stream_type: "logs",
            stream_name: "jobs",
            conditions: [
              { field: "service_name", op: "eq", value: "nightly-backup", ignore_case: false },
              { field: "message", op: "contains", value: "backup finished", ignore_case: true },
            ],
            period_secs: 86_400,
            silence_secs: 3_600,
            ...schedule,
          },
        ] as AutoObserveSuggestion["actions"],
      },
    );

  it("is a Missing alert with a plain why and an Add alert built from the action, nothing guessed", () => {
    const parts = insightOf(gt, zone, heartbeat(), NOW_MS);
    expect(parts.chip.label).toBe("Missing alert");
    expect(parts.headline).toBe("Nothing alerts if job nightly-backup stops succeeding");
    expect(parts.why).toBe("Its success line has appeared on each of the last 14 days.");
    expect(parts.cta?.label).toBe("Add alert");
    const target = parts.cta?.target;
    if (target?.type !== "create_alert") throw new Error("expected create_alert");
    expect(target.prefill).toMatchObject({
      streamType: "logs",
      streamName: "jobs",
      periodMinutes: 1440,
      frequencyMinutes: 60,
      silenceMinutes: 60,
    });
    expect(target.prefill.sql).toBe(
      'SELECT count(*) AS row_count FROM "jobs" WHERE "service_name" = \'nightly-backup\' AND lower("message") LIKE \'%backup finished%\' HAVING count(*) = 0',
    );
  });

  it("offers no Add alert for a cron schedule the alert form can't carry, rather than run it on another", () => {
    for (const schedule of [
      { frequency_secs: null, cron: "0 0 2 * * *" },
      { frequency_secs: 3_600, cron: "0 0 2 * * *" },
    ]) {
      const parts = insightOf(gt, zone, heartbeat(schedule), NOW_MS);
      expect(parts.cta).toBeNull();
      expect(parts.ai?.subject).toBe("nightly-backup");
    }
  });
});

describe("protect evidence", () => {
  it("shows nothing in Standard view", () => {
    const item = suggestion("protect_evidence", {}, { id: "pe-1" });
    expect(toRequests(gt, zone, [item], NOW_MS)).toEqual([]);
    expect(toSuggestionRows(gt, zone, [item], NOW_MS)).toEqual([]);
  });
});

describe("0, 1 and many", () => {
  it("renders nothing for no findings", () => {
    expect(toRequests(gt, zone, [], NOW_MS)).toEqual([]);
  });

  it("names a few services and folds the rest into 'and N more'", () => {
    const parts: InsightParts = insightOf(
      gt,
      zone,
      suggestion("silent_coverage", {
        monitor_name: "checkout-health",
        classes: ["absence"],
        service_count: 10,
        services: ["svc-a", "svc-b", "svc-c", "svc-d"],
      }),
      NOW_MS,
    );
    expect(parts.why).toContain("svc-a, svc-b, svc-c, and 7 more");
  });
});

describe("many coverage gaps fold into one card (0, 1, a few, many)", () => {
  const gap = (i: number, traffic = 10) =>
    suggestion(
      "coverage_gap",
      { service_name: `svc-${i}`, cells: NONE_CELLS, traffic_per_hour: traffic },
      {
        id: `gap-${i}`,
        subject: {
          kind: "service",
          key_dims: { service_name: `svc-${i}`, k8s_namespace_name: `ns-${i}` },
        },
      },
    );
  const gapRow = (i: number): AutoObserveCoverageRow => ({
    ...row([{ type: "logs", name: `logs_${i}` }]),
    service_id: `svc-${i}`,
    service_name: `svc-${i}`,
    namespace: `ns-${i}`,
  });
  const other = suggestion("source_silence", {}, { id: "other-1" });
  const requests = (count: number) => {
    const gaps = Array.from({ length: count }, (_, i) => gap(i));
    const rows = Array.from({ length: count }, (_, i) => gapRow(i));
    return toRequests(gt, zone, [other, ...gaps], NOW_MS, { rows });
  };

  it("keeps one card per service for none, one and a few", () => {
    expect(requests(0).map((r) => r.id)).toEqual(["other-1"]);
    expect(requests(1).map((r) => r.id)).toEqual(["other-1", "gap-0"]);
    expect(requests(5)).toHaveLength(6);
  });

  it("folds six or more into one card that names three and counts the rest", () => {
    const list = requests(10);
    expect(list.map((r) => r.id)).toEqual(["other-1", "coverage_gap-group"]);
    const parts = list[1].insight;
    expect(parts.headline).toBe("Nothing watches 10 services");
    expect(parts.chip.label).toBe("Coverage gap");
    expect(parts.why).toBe(
      "svc-0 (ns-0), svc-1 (ns-1), svc-2 (ns-2), and 7 more. They handle about 100 events an hour together.",
    );
    expect(parts.next).toBe("Add the 20 alerts AutoObserve drafted, in one list grouped by team.");
    expect(parts.dismissable).toBeNull();
  });

  it("groups by every gap the server counts, not only those on the rail's page (F8)", () => {
    const all = Array.from({ length: 7 }, (_, i) => gap(i));
    const rows = all.map((_, i) => gapRow(i));
    const list = toRequests(gt, zone, [other, all[0], all[1]], NOW_MS, {
      rows,
      allGaps: { suggestions: all, total: 9 },
    });
    expect(list.map((r) => r.id)).toEqual(["other-1", "coverage_gap-group"]);
    expect(list[1].covers).toBe(9);
    const parts = list[1].insight;
    expect(parts.headline).toBe("Nothing watches 9 services");
    expect(parts.why).toContain("svc-0 (ns-0), svc-1 (ns-1), svc-2 (ns-2), and 6 more.");
    const target = parts.cta?.target;
    if (target?.type !== "bulk") throw new Error("expected bulk");
    expect(new Set(target.request.rows.map((r) => r.scope.stream.name))).toEqual(
      new Set(all.map((_, i) => `logs_${i}`)),
    );
  });

  it("lists each service's drafts once when several gaps resolve to the same coverage row", () => {
    const gaps = [...Array.from({ length: 6 }, (_, i) => gap(i)), { ...gap(0), id: "gap-0-again" }];
    const list = toRequests(gt, zone, [other, ...gaps], NOW_MS, {
      rows: Array.from({ length: 6 }, (_, i) => gapRow(i)),
    });
    const target = list[1].insight.cta?.target;
    if (target?.type !== "bulk") throw new Error("expected bulk");
    const keys = target.request.rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps a service with no namespace apart from the same name in a namespace (T2-2)", () => {
    const named = (id: string, ns: string | null): AutoObserveCoverageRow => ({
      ...row([{ type: "logs", name: `logs_${id}` }]),
      service_id: id,
      service_name: "svc-b",
      namespace: ns,
    });
    const gapFor = (id: string, dims: Record<string, string>) =>
      suggestion(
        "coverage_gap",
        { service_name: "svc-b", cells: NONE_CELLS, traffic_per_hour: 1 },
        {
          id: `gap-${id}`,
          subject: { kind: "service", key_dims: { service_name: "svc-b", ...dims } },
        },
      );
    const gaps = [
      ...Array.from({ length: 5 }, (_, i) => gap(i)),
      gapFor("b-d", { entity_id: "b-d", k8s_namespace_name: "ns-d" }),
      gapFor("b-none", { entity_id: "b-none" }),
    ];
    const list = toRequests(gt, zone, [other, ...gaps], NOW_MS, {
      rows: [
        ...Array.from({ length: 5 }, (_, i) => gapRow(i)),
        named("b-d", "ns-d"),
        named("b-none", null),
      ],
    });
    const target = list[1].insight.cta?.target;
    if (target?.type !== "bulk") throw new Error("expected bulk");
    const streams = new Set(target.request.rows.map((r) => r.scope.stream.name));
    expect(streams.has("logs_b-d")).toBe(true);
    expect(streams.has("logs_b-none")).toBe(true);
  });

  it("names each drafted service the way the coverage map does (F-N4)", () => {
    const placed = (id: string, cluster: string): AutoObserveCoverageRow => ({
      ...row([{ type: "logs", name: `logs_${id}` }]),
      service_id: id,
      service_name: "svc-y",
      cluster,
      namespace: "ns-g",
    });
    const gapFor = (id: string) =>
      suggestion(
        "coverage_gap",
        { service_name: "svc-y", cells: NONE_CELLS, traffic_per_hour: 1 },
        { id: `gap-${id}`, subject: { kind: "service", key_dims: { entity_id: id } } },
      );
    const gaps = [...Array.from({ length: 5 }, (_, i) => gap(i)), gapFor("y-e"), gapFor("y-f")];
    const list = toRequests(gt, zone, [other, ...gaps], NOW_MS, {
      rows: [
        ...Array.from({ length: 5 }, (_, i) => gapRow(i)),
        placed("y-e", "cluster-e"),
        placed("y-f", "cluster-f"),
      ],
    });
    const target = list[1].insight.cta?.target;
    if (target?.type !== "bulk") throw new Error("expected bulk");
    const labels = new Map(target.request.rows.map((r) => [r.scope.stream.name, r.scope.label]));
    expect(labels.get("logs_y-e")).toBe("svc-y · cluster-e · ns-g");
    expect(labels.get("logs_y-f")).toBe("svc-y · cluster-f · ns-g");
    expect(labels.get("logs_0")).toBe("svc-0");
  });

  it("keeps one card per gap while the server counts fewer than six (F8)", () => {
    const all = Array.from({ length: 5 }, (_, i) => gap(i));
    const list = toRequests(gt, zone, [other, all[0], all[1]], NOW_MS, {
      rows: all.map((_, i) => gapRow(i)),
      allGaps: { suggestions: all, total: 5 },
    });
    expect(list.map((r) => r.id)).toEqual(["other-1", "gap-0", "gap-1"]);
  });

  it("reviews every service's draft in one list, and offers Review services and Ask AI", () => {
    const parts = requests(10)[1].insight;
    expect(parts.cta?.label).toBe("Review and add alerts");
    const target = parts.cta?.target;
    if (target?.type !== "bulk") throw new Error("expected bulk");
    expect(target.request.rows.map((r) => r.key)).toEqual(
      Array.from({ length: 10 }, (_, i) => [`svc-${i}:errors`, `svc-${i}:no_data`]).flat(),
    );
    expect(parts.secondary.map((c) => c.label)).toEqual(["Review services"]);
    expect(parts.ai?.request).toBe(
      "Set up alerts for 10 services that nothing watches, starting with svc-0 (ns-0), svc-1 (ns-1), and svc-2 (ns-2). Draft the missing alerts for each, show them to me, and don't save until I say so.",
    );
  });
});
