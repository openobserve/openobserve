// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it } from "vitest";

import {
  isLocalPrefsMigrated,
  judgeStream,
  loadSourcePrefs,
  markLocalPrefsMigrated,
  pendingIncludeMigrations,
  resolveSources,
  saveSourcePrefs,
  sourcesFromSettings,
  staleStreams,
  streamKey,
  streamsWithIncludeSetting,
  unsampledKey,
  suggestedSources,
  type SourcePrefs,
} from "./sourceSelection";

const CLOUDTRAIL_FIELDS = [
  "_timestamp",
  "eventname",
  "eventsource",
  "useridentity_type",
  "awsregion",
  "sourceipaddress",
  "eventid",
  "recipientaccountid",
  "useragent",
];
const CLOUDTRAIL_ROW = {
  eventname: "ConsoleLogin",
  eventsource: "signin.amazonaws.com",
  awsregion: "us-east-1",
};

const SYSLOG_FIELDS = ["_timestamp", "message", "program", "hostname", "facility"];

const prefs = (over: Partial<SourcePrefs> = {}): SourcePrefs => ({
  include: [],
  exclude: [],
  dismissed: [],
  classified: {},
  ...over,
});

describe("judgeStream", () => {
  it("auto-includes a confident CloudTrail stream whose sample fills the required fields", () => {
    const verdict = judgeStream(CLOUDTRAIL_FIELDS, [CLOUDTRAIL_ROW]);
    expect(verdict?.sourceId).toBe("aws_cloudtrail");
    expect(verdict?.decision).toBe("auto");
  });

  it("only suggests when no sample row is available", () => {
    expect(judgeStream(CLOUDTRAIL_FIELDS, [])?.decision).toBe("suggested");
  });

  it("suggests a syslog stream from schema, drops it when rows refute it, includes it on sshd", () => {
    expect(judgeStream(SYSLOG_FIELDS, [])?.decision).toBe("suggested");
    const plain = judgeStream(SYSLOG_FIELDS, [{ message: "cron ran", program: "CRON" }]);
    expect(plain?.decision).toBe("ignored");
    const auth = judgeStream(SYSLOG_FIELDS, [
      { message: "cron ran", program: "CRON" },
      { message: "Accepted publickey for root", program: "sshd", hostname: "web-1" },
    ]);
    expect(auth?.sourceId).toBe("linux_auth");
    expect(auth?.decision).toBe("auto");
  });

  it("returns null when nothing matches", () => {
    expect(judgeStream(["_timestamp", "foo"], [])).toBeNull();
  });
});

describe("resolveSources", () => {
  const all = ["vpc_flow_log", "ct_raw", "app_logs", "my_stream"];

  it("lists name matches, auto-included, then manual, and exclusions win", () => {
    const entries = resolveSources(
      all,
      prefs({
        include: ["my_stream", "gone_stream"],
        exclude: ["app_logs"],
        classified: {
          ct_raw: {
            key: "1",
            decision: "auto",
            sourceId: "aws_cloudtrail",
            label: "",
            confidence: 0.8,
          },
          app_logs: { key: "1", decision: "auto", sourceId: "x", label: "", confidence: 0.8 },
        },
      }),
    );
    expect(entries.map((e) => [e.name, e.reason])).toEqual([
      ["vpc_flow_log", "name"],
      ["ct_raw", "auto"],
      ["my_stream", "manual"],
    ]);
  });

  it("can exclude a stream that only matched by name", () => {
    expect(resolveSources(all, prefs({ exclude: ["vpc_flow_log"] }))).toEqual([]);
  });
});

describe("suggestedSources", () => {
  it("skips included and dismissed streams and sorts by confidence", () => {
    const verdict = (confidence: number) => ({
      key: "1",
      decision: "suggested" as const,
      sourceId: "s",
      label: "",
      confidence,
    });
    const out = suggestedSources(
      ["a", "b", "c", "audit_x"],
      prefs({
        dismissed: ["c"],
        classified: { a: verdict(0.4), b: verdict(0.6), c: verdict(0.6), audit_x: verdict(0.5) },
      }),
    );
    expect(out.map((e) => e.name)).toEqual(["b", "a"]);
  });
});

describe("staleStreams", () => {
  const verdict = (key: string) => ({
    key,
    decision: "ignored" as const,
    sourceId: "",
    label: "",
    confidence: 0,
  });

  it("reclassifies new, recreated and previously unsampled streams, busiest first", () => {
    const now = 10 * 86_400_000;
    const p = prefs({
      classified: {
        same: verdict(streamKey({ created_at: 5 })),
        recreated: verdict(streamKey({ created_at: 5 })),
        quietToday: verdict(unsampledKey({ created_at: 5 }, now)),
        quietYesterday: verdict(unsampledKey({ created_at: 5 }, now - 86_400_000)),
      },
    });
    expect(
      staleStreams(
        [
          { name: "same", stats: { created_at: 5 } },
          { name: "recreated", stats: { created_at: 9, doc_num: 1 } },
          { name: "quietToday", stats: { created_at: 5 } },
          { name: "quietYesterday", stats: { created_at: 5, doc_num: 50 } },
          { name: "new", stats: { doc_num: 10 } },
          { name: "_internal" },
        ],
        p,
        now,
      ),
    ).toEqual(["quietYesterday", "new", "recreated"]);
  });
});

describe("source prefs storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips and tolerates garbage", () => {
    saveSourcePrefs("o1", prefs({ include: ["x"] }));
    expect(loadSourcePrefs("o1").include).toEqual(["x"]);
    localStorage.setItem("oo_sec_sources_o2", "{not json");
    expect(loadSourcePrefs("o2")).toEqual(prefs());
  });
});

const sec = (over: Record<string, unknown> = {}) => ({
  source_type: "entity",
  pack_id: "entity",
  pack_version: 1,
  attached_at: 0,
  pipeline_id: "p1",
  pipeline_created: true,
  included: true,
  ...over,
});

describe("sourcesFromSettings (R13)", () => {
  it("maps packed streams, keeps included-but-unmapped ones, and drops excluded or setting-less streams", () => {
    const out = sourcesFromSettings([
      { name: "mapped", settings: { security: sec() } },
      { name: "included", settings: { security: sec({ pack_id: "", pack_version: 0 }) } },
      {
        name: "excluded",
        settings: { security: sec({ pack_id: "", pack_version: 0, included: false }) },
      },
      { name: "plain" },
    ]);
    expect(out).toEqual([
      {
        name: "mapped",
        state: "mapped",
        label: "Mapped entity@1",
        sourceType: "entity",
        pack: { id: "entity", version: 1 },
        included: true,
      },
      {
        name: "included",
        state: "included",
        label: "",
        sourceType: "entity",
        pack: null,
        included: true,
      },
    ]);
  });

  it("treats a mapped stream with included=false as a mapped source still", () => {
    const out = sourcesFromSettings([
      { name: "m", settings: { security: sec({ included: false }) } },
    ]);
    expect(out[0]).toMatchObject({ state: "mapped", included: false });
  });
});

describe("localStorage migration (R15)", () => {
  beforeEach(() => localStorage.clear());

  it("moves include/exclude choices once, skipping streams that already have a setting", () => {
    saveSourcePrefs("o1", prefs({ include: ["a", "b"], exclude: ["c"] }));
    const already = streamsWithIncludeSetting([
      { name: "b", settings: { security: sec({ included: false }) } },
    ]);
    expect(already.has("b")).toBe(true);

    const pending = pendingIncludeMigrations("o1", already);
    expect(pending).toEqual([
      { name: "a", included: true },
      { name: "c", included: false },
    ]);

    expect(isLocalPrefsMigrated("o1")).toBe(false);
    markLocalPrefsMigrated("o1");
    expect(isLocalPrefsMigrated("o1")).toBe(true);
    expect(pendingIncludeMigrations("o1", already)).toEqual([]);
  });
});
