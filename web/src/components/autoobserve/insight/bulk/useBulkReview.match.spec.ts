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
import { queryClient } from "@/composables/query/queryClient";
import type { BulkRow } from "./useBulkReview";

const api = vi.hoisted(() => ({
  folders: vi.fn(),
  schema: vi.fn(),
  alerts: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/services/common", () => ({ default: { list_Folders: api.folders } }));
vi.mock("@/services/stream", () => ({ default: { schema: api.schema } }));
vi.mock("@/services/alerts", () => ({ default: { listByFolderId: api.alerts } }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...a: unknown[]) => api.fetch(...a),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

const { closeBulkReview, isTickable, loadReviewContext, openBulkReview, useBulkReview } =
  await import("./useBulkReview");
const { blockLine } = await import("./bulkCopy");
const { forgetMatches } = await import("../targets/scopeMatch");
const { b64DecodeUnicode } = await import("@/utils/zincutils");

const original = config.isEnterprise;
const review = useBulkReview();
const ORG = "demo-org";

const noData = (service: string, stream: string): BulkRow => ({
  key: `${service}:no_data`,
  kind: "no_data",
  scope: { service, cluster: null, namespace: null, stream: { type: "logs", name: stream } },
  usually: null,
});

// Rows per stream on the walk server: batch_x1 names only svc-batch-x1; pay_api had none for 14 days.
const ROWS: Record<string, { total: number; matching: Record<string, number> }> = {
  batch_x1: { total: 4168, matching: { "svc-batch-x1": 4168 } },
  pay_api: { total: 0, matching: {} },
};

const answerFromStreams = () =>
  api.fetch.mockImplementation((req: any, handlers: any) => {
    const sql = b64DecodeUnicode(req.queryReq.query.sql) ?? "";
    const stream = /FROM "([^"]+)"/.exec(sql)?.[1] ?? "";
    const service = /"service_name" = '([^']+)'/.exec(sql)?.[1] ?? "";
    const data = ROWS[stream] ?? { total: 0, matching: {} };
    const rows = sql.includes(" WHERE ") ? (data.matching[service] ?? 0) : data.total;
    const hits = rows ? [{ n: 1 }] : [];
    handlers.data(null, { type: "search_response_hits", content: { results: { hits } } });
    handlers.complete();
  });

const rowOf = (key: string) => review.reviewRows.value.find((r) => r.key === key)!;

beforeEach(() => {
  config.isEnterprise = "true";
  queryClient.clear();
  forgetMatches();
  api.folders.mockReset().mockResolvedValue({ data: { list: [] } });
  api.schema.mockReset().mockResolvedValue({ data: { schema: [{ name: "service_name" }] } });
  api.alerts.mockReset().mockResolvedValue({ data: { list: [] } });
  api.fetch.mockReset();
  answerFromStreams();
});

afterEach(() => {
  closeBulkReview();
  config.isEnterprise = original;
});

describe("the review never offers an alert that can't match its own stream", () => {
  it("marks a catalog service whose name no row of its stream carries as can't build, unticked", async () => {
    openBulkReview({
      kind: "no_data",
      rows: [noData("batchjobs", "batch_x1"), noData("svc-batch-x1", "batch_x1")],
    });
    await loadReviewContext(ORG);
    const blind = rowOf("batchjobs:no_data");
    expect(blind.block).toEqual({ code: "noMatch" });
    expect(isTickable(blind)).toBe(false);
    expect(review.state.ticked.has(blind.key)).toBe(false);
    expect(String(blockLine(gt, blind, review.reviewRows.value))).toBe(
      "No row in batch_x1 names batchjobs in 7 days, so an alert for it could never fire.",
    );
    expect(review.toCreate.value.map((r) => r.key)).toEqual(["svc-batch-x1:no_data"]);
  });

  it("keeps a no-data draft on a stream that had no rows at all (payments on pay_api)", async () => {
    openBulkReview({ kind: "no_data", rows: [noData("payments", "pay_api")] });
    await loadReviewContext(ORG);
    expect(rowOf("payments:no_data").block).toBeNull();
    expect(review.toCreate.value.map((r) => r.key)).toEqual(["payments:no_data"]);
  });

  it("waits for the answer before anything can be added", async () => {
    let finish!: () => void;
    api.fetch.mockImplementation((req: any, handlers: any) => {
      const filtered = (b64DecodeUnicode(req.queryReq.query.sql) ?? "").includes(" WHERE ");
      const reply = () => {
        handlers.data(null, {
          type: "search_response_hits",
          content: { results: { hits: filtered ? [] : [{ n: 1 }] } },
        });
        handlers.complete();
      };
      if (filtered) finish = reply;
      else reply();
    });
    openBulkReview({ kind: "no_data", rows: [noData("batchjobs", "batch_x1")] });
    const loading = loadReviewContext(ORG);
    await vi.waitFor(() => expect(api.fetch).toHaveBeenCalled());
    expect(rowOf("batchjobs:no_data").block).toEqual({ code: "checking" });
    expect(review.toCreate.value).toHaveLength(0);
    finish();
    await loading;
    expect(rowOf("batchjobs:no_data").block).toEqual({ code: "noMatch" });
  });

  it("keeps the draft when the check can't run, as before", async () => {
    api.fetch.mockImplementation((_req: unknown, handlers: any) => handlers.error());
    openBulkReview({ kind: "no_data", rows: [noData("batchjobs", "batch_x1")] });
    await loadReviewContext(ORG);
    expect(rowOf("batchjobs:no_data").block).toBeNull();
  });
});
