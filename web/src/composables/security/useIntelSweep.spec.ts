// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Indicator } from "@/utils/security/intel";

const runSql = vi.fn();
vi.mock("@/composables/security/useSecurityStreamPlans", async (importActual) => ({
  ...(await importActual<typeof import("@/composables/security/useSecurityStreamPlans")>()),
  runSql: (...a: unknown[]) => runSql(...a),
}));
const schemas: Record<string, string[]> = {};
vi.mock("@/services/stream", () => ({
  default: {
    nameList: async () => ({ data: { list: Object.keys(schemas).map((name) => ({ name })) } }),
    schema: async (_org: string, stream: string) => ({
      data: { schema: schemas[stream].map((name) => ({ name })) },
    }),
  },
}));
vi.mock("@/utils/security/classify", () => ({ bestMatch: () => null }));
vi.mock("@/utils/security/sourceSelection", () => ({
  securitySourceNames: (_org: string, all: string[]) => all,
}));

import { useIntelSweep } from "./useIntelSweep";

const ind = (indicator: string, type: Indicator["type"] = "ip"): Indicator => ({
  indicator,
  type,
  severity: "high",
  confidence: 80,
  source: "",
  description: "",
  addedAt: "",
  expiresAt: "",
  table: "ioc_x",
});

describe("useIntelSweep", () => {
  beforeEach(() => {
    runSql.mockReset();
    for (const k of Object.keys(schemas)) delete schemas[k];
  });

  it("searches every candidate column of a stream in one query and attributes rows to columns", async () => {
    schemas.fw = ["_timestamp", "src_ip", "dst_ip", "message"];
    runSql.mockResolvedValue({
      hits: [
        // dst_ip is column 0 (sorted), src_ip column 1
        { zo_v0: "1.2.3.4", zo_v1: null, zo_n: 2, zo_first: 10, zo_last: 20, zo_raw0: "1.2.3.4" },
        {
          zo_v0: "1.2.3.4",
          zo_v1: "5.6.7.8",
          zo_n: 3,
          zo_first: 5,
          zo_last: 30,
          zo_raw0: "1.2.3.4",
          zo_raw1: "5.6.7.8",
        },
      ],
      partial: false,
      functionError: "",
    });
    const sweep = useIntelSweep();
    await sweep.run("org", [ind("1.2.3.4"), ind("5.6.7.8"), ind("1.2.3.4")], { start: 0, end: 1 });

    expect(runSql).toHaveBeenCalledTimes(1);
    const sql = String(runSql.mock.calls[0][1]);
    expect(sql).toContain(
      `LOWER(CAST("dst_ip" AS VARCHAR)) IN ('1.2.3.4', '5.6.7.8') OR LOWER(CAST("src_ip"`,
    );
    expect(sweep.planned.value).toBe(1);
    expect(sweep.done.value).toBe(1);
    const byIndicator = Object.fromEntries(
      sweep.matches.value.map((m) => [m.indicator.indicator, m]),
    );
    expect(byIndicator["1.2.3.4"]).toMatchObject({ hits: 5, first: 5, last: 30 });
    expect(byIndicator["1.2.3.4"].sightings).toEqual([
      { stream: "fw", column: "dst_ip", raw: "1.2.3.4", count: 5, first: 5, last: 30 },
    ]);
    expect(byIndicator["5.6.7.8"].sightings).toEqual([
      { stream: "fw", column: "src_ip", raw: "5.6.7.8", count: 3, first: 5, last: 30 },
    ]);
    expect(sweep.coverage.value[0].columns).toEqual([
      { stream: "fw", column: "dst_ip" },
      { stream: "fw", column: "src_ip" },
    ]);
  });

  it("runs one query per stream and batch, and a failed one marks all its columns skipped", async () => {
    schemas.a = ["src_ip", "dst_ip"];
    schemas.b = ["client_ip"];
    runSql.mockImplementation(async (_org: string, sql: string) => {
      if (sql.includes(`FROM "b"`)) throw new Error("boom");
      return { hits: [], partial: false, functionError: "" };
    });
    const values = Array.from({ length: 401 }, (_, i) => ind(`10.0.${i >> 8}.${i & 255}`));
    const sweep = useIntelSweep();
    await sweep.run("org", values, { start: 0, end: 1 });

    expect(runSql).toHaveBeenCalledTimes(4);
    expect(sweep.planned.value).toBe(4);
    expect(sweep.failed.value).toBe(2);
    expect(sweep.coverage.value[0]).toMatchObject({
      indicators: 401,
      columns: [
        { stream: "a", column: "dst_ip" },
        { stream: "a", column: "src_ip" },
      ],
      skipped: [{ stream: "b", column: "client_ip" }],
    });
  });
});
