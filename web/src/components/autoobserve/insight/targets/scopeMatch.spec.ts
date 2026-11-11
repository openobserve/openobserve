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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/locales";
import config from "@/aws-exports";

const api = vi.hoisted(() => ({ fetch: vi.fn(), cancel: vi.fn() }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...a: unknown[]) => api.fetch(...a),
    cancelStreamQueryBasedOnRequestId: (...a: unknown[]) => api.cancel(...a),
  }),
}));

const { cancelProbes, checkScopeMatch, forgetMatches, knownMatch, probeScopes, scopeMatchSql } =
  await import("./scopeMatch");
const { resolveDraft } = await import("./alertDraft");
const { noDataAlert } = await import("../bulk/bulkTargets");
const { b64DecodeUnicode } = await import("@/utils/zincutils");

const ORG = "demo-org";
// The walk server's catalog joins batch_x1 to batchjobs, but every row there names svc-batch-x1.
const BATCH = {
  service: "batchjobs",
  cluster: null,
  namespace: null,
  stream: { type: "logs", name: "batch_x1" },
};
const SCHEMA = ["_timestamp", "service_name", "level", "message"];

const ROW = [{ n: 1 }];

// Answers the filtered probe and the unfiltered one separately, as the stream would.
const answer = (filtered: Record<string, unknown>[], any: Record<string, unknown>[]) =>
  api.fetch.mockImplementation((req: any, handlers: any) => {
    const sql = b64DecodeUnicode(req.queryReq.query.sql) ?? "";
    const hits = sql.includes(" WHERE ") ? filtered : any;
    handlers.data(null, { type: "search_response_hits", content: { results: { hits } } });
    handlers.complete();
  });

const sentSql = (call = 0): string =>
  b64DecodeUnicode(api.fetch.mock.calls[call][0].queryReq.query.sql) ?? "";

let enterprise: string;

beforeEach(() => {
  enterprise = config.isEnterprise;
  config.isEnterprise = "true";
  api.fetch.mockReset();
  api.cancel.mockReset();
  cancelProbes();
  forgetMatches();
});

afterEach(() => {
  config.isEnterprise = enterprise;
});

describe("checkScopeMatch: a draft must match rows of its own stream", () => {
  it("asks whether one row exists, filtered and then unfiltered, never counting the stream", () => {
    const sql = scopeMatchSql({ ...BATCH, schema: SCHEMA });
    expect(sql).toEqual({
      filtered: `SELECT 1 AS n FROM "batch_x1" WHERE "service_name" = 'batchjobs' LIMIT 1`,
      any: `SELECT 1 AS n FROM "batch_x1" LIMIT 1`,
    });
    for (const q of Object.values(sql!)) {
      expect(q).toMatch(/ LIMIT 1$/);
      expect(q).not.toMatch(/count\(|sum\(/i);
    }
  });

  it("says match on the first filtered row and asks nothing more", async () => {
    answer(ROW, ROW);
    expect(await checkScopeMatch(ORG, { ...BATCH, schema: SCHEMA })).toBe("match");
    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(sentSql()).toContain(" WHERE ");
  });

  it("says none when the stream has rows but none carry the service (batchjobs on batch_x1)", async () => {
    answer([], ROW);
    expect(await checkScopeMatch(ORG, { ...BATCH, schema: SCHEMA })).toBe("none");
    expect(api.fetch).toHaveBeenCalledTimes(2);
    expect(sentSql(1)).toBe(`SELECT 1 AS n FROM "batch_x1" LIMIT 1`);
    expect(knownMatch(ORG, BATCH)).toBe("none");
  });

  it("says quiet when the stream had no rows at all, so a no-data alert there stays (payments on pay_api)", async () => {
    answer([], []);
    const pay = { ...BATCH, service: "payments", stream: { type: "logs", name: "pay_api" } };
    expect(await checkScopeMatch(ORG, { ...pay, schema: SCHEMA })).toBe("quiet");
  });

  it("answers null and keeps nothing when the read fails, so nothing is ruled out on a guess", async () => {
    api.fetch.mockImplementation((_req: unknown, handlers: any) => handlers.error());
    expect(await checkScopeMatch(ORG, { ...BATCH, schema: SCHEMA })).toBeNull();
    expect(knownMatch(ORG, BATCH)).toBeUndefined();
  });

  it("answers null when only the unfiltered read fails", async () => {
    api.fetch.mockImplementation((req: any, handlers: any) => {
      const sql = b64DecodeUnicode(req.queryReq.query.sql) ?? "";
      if (!sql.includes(" WHERE ")) return handlers.error();
      handlers.data(null, { type: "search_response_hits", content: { results: { hits: [] } } });
      handlers.complete();
    });
    expect(await checkScopeMatch(ORG, { ...BATCH, schema: SCHEMA })).toBeNull();
    expect(knownMatch(ORG, BATCH)).toBeUndefined();
  });

  it("reads each stream's fields once and asks once per scope", async () => {
    answer(ROW, ROW);
    const fields = vi.fn(async () => ({ names: SCHEMA, types: {} }));
    await probeScopes(ORG, [BATCH, { ...BATCH }], fields);
    await probeScopes(ORG, [BATCH], fields);
    expect(fields).toHaveBeenCalledTimes(1);
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });
});

// Holds every probe open until the test finishes it, counting the ones still running.
const holdProbes = () => {
  const open = new Map<string, { sql: string; finish: () => void }>();
  let peak = 0;
  api.fetch.mockImplementation((req: any, handlers: any) => {
    const sql = b64DecodeUnicode(req.queryReq.query.sql) ?? "";
    open.set(req.traceId, {
      sql,
      finish: () => {
        open.delete(req.traceId);
        handlers.data(null, { type: "search_response_hits", content: { results: { hits: ROW } } });
        handlers.complete();
      },
    });
    peak = Math.max(peak, open.size);
  });
  api.cancel.mockImplementation((req: { trace_id: string }) => open.delete(req.trace_id));
  return {
    open,
    peak: () => peak,
    finishAll: async () => {
      while (open.size) {
        for (const probe of [...open.values()]) probe.finish();
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
};

const settle = () => new Promise((r) => setTimeout(r, 0));
const onStream = (name: string, service = "svc") => ({
  ...BATCH,
  service,
  stream: { type: "logs", name },
});

describe("probeScopes: one page-level pool for the home page's gap drafts", () => {
  it("500 gap services on one stream make 1 schema read and at most 2 probes per distinct scope", async () => {
    answer([], ROW);
    const scopes = Array.from({ length: 500 }, (_, i) => ({ ...BATCH, service: `svc-${i}` }));
    const fields = vi.fn(async () => ({ names: SCHEMA, types: {} }));
    await probeScopes(ORG, [...scopes, ...scopes], fields);
    expect(fields).toHaveBeenCalledTimes(1);
    expect(api.fetch.mock.calls.length).toBeLessThanOrEqual(2 * 500);
    const unfiltered = api.fetch.mock.calls.filter((_, i) => !sentSql(i).includes(" WHERE "));
    expect(unfiltered.length).toBeLessThanOrEqual(4);
    expect(knownMatch(ORG, scopes[499])).toBe("none");
    await probeScopes(ORG, [{ ...BATCH, service: "svc-new" }], fields);
    expect(fields).toHaveBeenCalledTimes(1);
  });

  it("runs at most 4 probes at once across every caller", async () => {
    const probes = holdProbes();
    const fields = vi.fn(async () => ({ names: SCHEMA, types: {} }));
    const first = Array.from({ length: 6 }, (_, i) => onStream(`a_${i}`));
    const second = Array.from({ length: 6 }, (_, i) => onStream(`b_${i}`));
    void probeScopes(ORG, first, fields);
    await settle();
    void probeScopes(ORG, second, fields);
    await settle();
    await probes.finishAll();
    expect(probes.peak()).toBeLessThanOrEqual(4);
  });

  it("a refresh cancels the previous run's pending probes", async () => {
    const probes = holdProbes();
    const fields = vi.fn(async () => ({ names: SCHEMA, types: {} }));
    const first = Array.from({ length: 8 }, (_, i) => onStream(`a_${i}`));
    void probeScopes(ORG, first, fields);
    await settle();
    expect(probes.open.size).toBe(4);
    void probeScopes(ORG, [onStream("b_0")], fields);
    await settle();
    expect(api.cancel).toHaveBeenCalledTimes(4);
    await probes.finishAll();
    const asked = api.fetch.mock.calls.map((_, i) => sentSql(i));
    for (const s of first.slice(4))
      expect(asked.some((q) => q.includes(`"${s.stream.name}"`))).toBe(false);
    expect(asked.some((q) => q.includes(`"b_0"`))).toBe(true);
  });

  it("cancelProbes stops the run: in-flight probes are cancelled and nothing more is sent", async () => {
    const probes = holdProbes();
    const fields = vi.fn(async () => ({ names: SCHEMA, types: {} }));
    const run = probeScopes(
      ORG,
      Array.from({ length: 8 }, (_, i) => onStream(`a_${i}`)),
      fields,
    );
    await settle();
    const sent = api.fetch.mock.calls.length;
    cancelProbes();
    await run;
    await probes.finishAll();
    expect(api.cancel).toHaveBeenCalledTimes(sent);
    expect(api.fetch.mock.calls.length).toBe(sent);
  });
});

describe("the single Add alert refuses a draft that matches no rows", () => {
  it("blocks Save with the reason when the stream holds no row of the service", async () => {
    answer([], ROW);
    const own = {
      team: {
        name: "",
        folderId: "default",
        folderName: "default",
        source: "default" as const,
        reason: "" as never,
      },
      notify: { destinations: [] as [], reason: "none" as const },
    };
    const build = (s: typeof BATCH) => noDataAlert(s, own);
    const out = await resolveDraft(ORG, { scope: BATCH, build }, build(BATCH)!, async () => ({
      names: SCHEMA,
      types: {},
    }));
    const blocking = out.prefill.warnings.filter((w) => w.level === "blocking");
    expect(blocking).toEqual([
      {
        key: "autoobserve.noMatch",
        level: "blocking",
        params: { stream: "batch_x1", service: "batchjobs" },
      },
    ]);
  });

  it("keeps the no-data draft on a stream that had no rows at all", async () => {
    answer([], []);
    const own = {
      team: {
        name: "",
        folderId: "default",
        folderName: "default",
        source: "default" as const,
        reason: "" as never,
      },
      notify: { destinations: [] as [], reason: "none" as const },
    };
    const build = (s: typeof BATCH) => noDataAlert(s, own);
    const out = await resolveDraft(ORG, { scope: BATCH, build }, build(BATCH)!, async () => ({
      names: SCHEMA,
      types: {},
    }));
    expect(out.prefill.warnings.filter((w) => w.level === "blocking")).toEqual([]);
    expect(out.prefill.sql).toContain(`"service_name" = 'batchjobs'`);
  });
});
