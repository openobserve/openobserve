// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  DAY_US,
  HOUR_US,
  VALUE_COUNT_SIZE,
  clearValueCounts,
  insertLabelIntoPromql,
  loadValueCounts,
  streamOptions,
  useFilterDiscovery,
  valueNotSeenHint,
  type DiscoveryStream,
} from "./useStreamDiscovery";

type Handlers = { data: (p: unknown, r: unknown) => void; error: () => void; complete: () => void };
const stream = vi.fn();

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...args: unknown[]) => stream(...args),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

const t = i18n.global.t as unknown as TranslateFn;
const NOW = 1_700_000_000_000_000;
const ctx = { org: "default", streamType: "logs", streamName: "k8s_events" };

const answerWith = (byKeyword: Record<string, [string, number][] | null>) =>
  stream.mockImplementation((req: { queryReq: { keyword?: string } }, handlers: Handlers) => {
    const values = byKeyword[req.queryReq.keyword ?? ""];
    if (values === null) return handlers.error();
    const hit = { values: (values ?? []).map(([key, n]) => ({ zo_sql_key: key, zo_sql_num: n })) };
    handlers.data({}, { type: "search_response_hits", content: { results: { hits: [hit] } } });
    handlers.complete();
  });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("streamOptions", () => {
  const row = (name: string, lastAgoUs: number | null, extra: Partial<DiscoveryStream> = {}) => ({
    name,
    stats:
      lastAgoUs === null
        ? { doc_num: 0, doc_time_min: 0, doc_time_max: 0 }
        : {
            doc_num: 44_000,
            doc_time_min: NOW - lastAgoUs - 2 * HOUR_US,
            doc_time_max: NOW - lastAgoUs,
          },
    ...extra,
  });

  it.each([
    {
      name: "receiving first with last event and rate, no-data streams last and greyed",
      streams: [row("old", 2 * DAY_US), row("nginx", 12_000_000), row("never", null)],
      recent: [],
      expected: [
        ["Receiving data", undefined],
        ["nginx", "Last event 12 s ago · 22K/h"],
        ["No recent data", undefined],
        ["old", "No data in 24 h"],
        ["never", "No data in 24 h"],
      ],
    },
    {
      name: "a remembered stream leads under Recent; one group needs no heading",
      streams: [row("a", 60_000_000), row("b", 60_000_000)],
      recent: ["b"],
      expected: [
        ["Recent", undefined],
        ["b", "Last event 1 min ago · 22K/h"],
        ["Receiving data", undefined],
        ["a", "Last event 1 min ago · 22K/h"],
      ],
    },
    {
      name: "all streams in one group read as a plain list",
      streams: [row("a", 60_000_000), row("b", 60_000_000)],
      recent: [],
      expected: [
        ["a", "Last event 1 min ago · 22K/h"],
        ["b", "Last event 1 min ago · 22K/h"],
      ],
    },
  ])("$name", ({ streams, recent, expected }) => {
    const options = streamOptions(streams, { t, nowUs: NOW, recent });
    expect(options.map((o) => [String(o.label), o.subLabel && String(o.subLabel)])).toEqual(
      expected,
    );
    expect(options.filter((o) => o.stale).map((o) => o.value)).toEqual(
      expected.filter(([, hint]) => hint === "No data in 24 h").map(([name]) => name),
    );
  });

  it("describes a metric by type, unit and help, and makes the help searchable", () => {
    const [cpu] = streamOptions(
      [
        row("node_cpu_seconds_total", 30_000_000, {
          stream_type: "metrics",
          metrics_meta: {
            metric_type: "Counter",
            metric_family_name: "node_cpu_seconds_total",
            help: "Seconds the CPUs spent in each mode",
            unit: "seconds",
          },
        }),
      ],
      { t, nowUs: NOW },
    );
    expect(String(cpu.subLabel)).toBe("Counter · seconds · Seconds the CPUs spent in each mode");
    expect(cpu.searchText).toContain("cpus spent");
  });
});

describe("value counts", () => {
  beforeEach(() => {
    stream.mockReset();
    clearValueCounts();
  });

  it("asks the streaming values endpoint for the last 24 hours once per field", async () => {
    answerWith({ "": [["Killing", 53_920]] });
    const entry = await loadValueCounts(ctx, "body_object_reason");
    await loadValueCounts(ctx, "body_object_reason");
    expect(stream).toHaveBeenCalledTimes(1);
    const [request] = stream.mock.calls[0] as [
      { type: string; queryReq: { fields: string[]; start_time: number; end_time: number } },
    ];
    expect(request.type).toBe("values");
    expect(request.queryReq.fields).toEqual(["body_object_reason"]);
    expect(request.queryReq.end_time - request.queryReq.start_time).toBe(DAY_US);
    expect(entry.values).toEqual([{ value: "Killing", count: 53_920 }]);
  });

  it("asks again after a failed lookup", async () => {
    answerWith({ "": null });
    expect((await loadValueCounts(ctx, "reason")).state).toBe("failed");
    answerWith({ "": [["Killing", 3]] });
    expect((await loadValueCounts(ctx, "reason")).state).toBe("ready");
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("serves a typed search from a complete answer without another request", async () => {
    answerWith({
      "": [
        ["ERROR", 10],
        ["error_budget", 2],
        ["INFO", 9],
      ],
    });
    const { loadValues, valueLabel } = useFilterDiscovery(() => ctx, t);
    expect(await loadValues("level", "err")).toEqual(["ERROR", "error_budget"]);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(valueLabel("level", "ERROR")).toEqual({ label: "ERROR", detail: "10" });
  });

  const full = Array.from({ length: VALUE_COUNT_SIZE }, (_, i) => [`v${i}`, 100 - i]) as [
    string,
    number,
  ][];

  it.each([
    {
      name: "a typed value never seen names the closest values",
      values: [
        ["Killing", 53_920],
        ["OOMKilling", 412],
        ["Started", 9],
      ] as [string, number][],
      typed: ["OOMKilled"],
      op: "eq",
      hint: "OOMKilled hasn't appeared in the last 24 hours. Seen: OOMKilling (412), Killing (53,920), and Started (9).",
    },
    {
      name: "the exact value differs only in case",
      values: [["ERROR", 3_509]] as [string, number][],
      typed: ["error"],
      op: "eq",
      hint: "error hasn't appeared in the last 24 hours. Seen: ERROR (3,509).",
    },
    {
      name: "a seen value",
      values: [["Killing", 1]] as [string, number][],
      typed: ["Killing"],
      op: "in",
      hint: undefined,
    },
    {
      name: "contains a seen part",
      values: [["Memory cgroup out of memory", 1]] as [string, number][],
      typed: ["out of memory"],
      op: "contains",
      hint: undefined,
    },
    {
      name: "a regex is not judged",
      values: [["a", 1]] as [string, number][],
      typed: ["b.*"],
      op: "regex",
      hint: undefined,
    },
    {
      name: "a field with no values",
      values: [] as [string, number][],
      typed: ["x"],
      op: "eq",
      hint: "No values in the last 24 hours",
    },
    {
      name: "a cut-off top list is not trusted alone",
      values: full,
      typed: ["rare"],
      op: "eq",
      hint: undefined,
    },
  ])("$name", async ({ values, typed, op, hint }) => {
    answerWith({ "": values });
    await loadValueCounts(ctx, "reason");
    const text = valueNotSeenHint(ctx, "reason", typed, op as never, t);
    expect(text && String(text)).toBe(hint);
  });

  it("trusts a cut-off top list once a lookup for the value itself finds nothing", async () => {
    answerWith({ "": full, rare: [] });
    await loadValueCounts(ctx, "reason");
    expect(valueNotSeenHint(ctx, "reason", ["rare"], "eq", t)).toBeUndefined();
    await flush();
    expect(String(valueNotSeenHint(ctx, "reason", ["rare"], "eq", t))).toContain(
      "rare hasn't appeared",
    );
  });
});

describe("insertLabelIntoPromql", () => {
  const m = "node_cpu_seconds_total";
  it.each([
    ["", undefined, `avg by (k8s_node_name) (${m})`],
    ["", "n1", `${m}{k8s_node_name="n1"}`],
    [`rate(${m}[5m])`, "n1", `rate(${m}{k8s_node_name="n1"}[5m])`],
    [`rate(${m}{mode="idle"}[5m])`, 'a"b', `rate(${m}{mode="idle", k8s_node_name="a\\"b"}[5m])`],
    [`rate(${m}[5m])`, undefined, `avg by (k8s_node_name) (rate(${m}[5m]))`],
    [`sum by (cpu) (rate(${m}[5m]))`, undefined, `sum by (cpu, k8s_node_name) (rate(${m}[5m]))`],
    [`sum by (k8s_node_name) (x)`, undefined, `sum by (k8s_node_name) (x)`],
    [`rate(${m}_extra[5m])`, "n1", `rate(${m}_extra[5m])`],
  ])("%s + %s", (query, value, expected) => {
    expect(insertLabelIntoPromql(query, m, "k8s_node_name", value)).toBe(expected);
  });
});
