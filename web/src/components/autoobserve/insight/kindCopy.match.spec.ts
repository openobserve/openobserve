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
import { gt } from "@/types/i18n";
import type { AutoObserveCoverageRow, AutoObserveSuggestion } from "@/services/autoobserve";

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...a: unknown[]) => api.fetch(...a),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

const { toRequests, toSuggestionRows } = await import("../live/liveAdapter");
const { gapDraftScopes } = await import("./kindCopy");
const { forgetMatches, probeScopes } = await import("./targets/scopeMatch");
const { cantBuildKinds } = await import("./coverageCta");
const { b64DecodeUnicode } = await import("@/utils/zincutils");

const NOW_MS = Date.UTC(2026, 10, 11, 7, 0);
const zone = { locale: "en-US", timeZone: "UTC" };
const ORG = "demo-org";
const SCHEMA = { names: ["_timestamp", "service_name", "level"], types: { level: "Utf8" } };

const NONE_CELLS = {
  errors: { state: "none", evidence: [], counts: {} },
  latency: { state: "none", evidence: [], counts: {} },
  absence: { state: "none", evidence: [], counts: {} },
};

const gap = (name: string): AutoObserveSuggestion => ({
  id: `gap-${name}`,
  org: ORG,
  analyzer: "coverage",
  kind: "coverage_gap",
  subject: { kind: "service", key_dims: { entity_id: `id-${name}`, service_name: name } },
  evidence: { service_name: name, cells: NONE_CELLS, traffic_per_hour: 10 },
  score: 1,
  confidence: "sufficient",
  status: "proposed",
  decided_score: null,
  on_accept: null,
});

const gapRow = (name: string, stream: string): AutoObserveCoverageRow => ({
  service_id: `id-${name}`,
  service_name: name,
  cluster: null,
  namespace: null,
  streams: [{ type: "logs", name: stream }],
  traffic_per_hour: 10,
  cells: NONE_CELLS as AutoObserveCoverageRow["cells"],
});

// The catalog lists batch_x1..x3 under batchjobs, yet each row there names svc-batch-xN.
const BATCH = { gap: gap("batchjobs"), row: gapRow("batchjobs", "batch_x1") };
const others = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    gap: gap(`svc-${i}`),
    row: gapRow(`svc-${i}`, `logs_${i}`),
  }));

const answerFromStreams = () =>
  api.fetch.mockImplementation((req: any, handlers: any) => {
    const sql = b64DecodeUnicode(req.queryReq.query.sql) ?? "";
    const blind = sql.includes(`'batchjobs'`);
    const hits = blind && sql.includes(" WHERE ") ? [] : [{ n: 1 }];
    handlers.data(null, { type: "search_response_hits", content: { results: { hits } } });
    handlers.complete();
  });

const bulkRows = (
  cta: { target: { type: string; request?: { rows: { key: string }[] } } } | null,
) => (cta?.target.type === "bulk" ? cta.target.request!.rows.map((r) => r.key) : []);

const railOf = async (services: { gap: AutoObserveSuggestion; row: AutoObserveCoverageRow }[]) => {
  const gaps = services.map((s) => s.gap);
  const ctx = { rows: services.map((s) => s.row) };
  await probeScopes(ORG, gapDraftScopes(gt, gaps, ctx), async () => SCHEMA);
  return toRequests(gt, zone, gaps, NOW_MS, {
    ...ctx,
    allGaps: { suggestions: gaps, total: gaps.length },
  });
};

let enterprise: string;

beforeEach(() => {
  enterprise = config.isEnterprise;
  config.isEnterprise = "true";
  forgetMatches();
  api.fetch.mockReset();
  answerFromStreams();
});

afterEach(() => {
  config.isEnterprise = enterprise;
});

describe("the home cards never promise an alert that can't match its stream", () => {
  it("leaves the unmatched service's drafts out of the group card's list and count", async () => {
    const parts = (await railOf([BATCH, ...others(19)]))[0].insight;
    expect(parts.headline).toBe("Nothing watches 20 services");
    expect(bulkRows(parts.cta)).toHaveLength(38);
    expect(bulkRows(parts.cta).some((k) => k.startsWith("id-batchjobs:"))).toBe(false);
    expect(parts.note).toBe(
      "Opens a list of 38 alerts AutoObserve filled in. Nothing is saved until you click Add alerts.",
    );
  });

  it("offers no Add on the single card and says why, the same in All suggestions", async () => {
    const [first] = await railOf([BATCH]);
    expect(first.insight.cta?.action).toBe("openService");
    expect(String(first.insight.next)).toBe(
      "Latency needs traces first. No row in batch_x1 names batchjobs in 7 days, so an alert for it could never fire.",
    );
    const rows = toSuggestionRows(gt, zone, [BATCH.gap], NOW_MS, { rows: [BATCH.row] });
    expect(rows[0].insight.cta?.action).toBe("openService");
  });

  it("still offers the drafts before the check answers, as before", () => {
    const rows = toSuggestionRows(gt, zone, [BATCH.gap], NOW_MS, { rows: [BATCH.row] });
    expect(rows[0].insight.cta?.action).toBe("reviewAndAddAlerts");
  });
});

describe("the coverage drawer counts only drafts that match the stream", () => {
  it("rules out both drafts of the unmatched service", async () => {
    const cell = (stateKey: string) => ({
      state: stateKey === "covered" ? "watched" : "gap",
      engine: { stateKey, monitors: [] },
    });
    const row = {
      service: "batchjobs",
      stream: "batch_x1",
      cells: {},
      checks: { errors: cell("none"), latency: cell("covered"), absence: cell("none") },
      identity: {
        serviceId: "id-batchjobs",
        serviceName: "batchjobs",
        cluster: null,
        namespace: null,
        streams: [{ type: "logs", name: "batch_x1" }],
      },
    } as never;
    const cant = await cantBuildKinds(ORG, row, async () => SCHEMA);
    expect([...cant].sort()).toEqual(["errors", "no_data"]);
  });
});
