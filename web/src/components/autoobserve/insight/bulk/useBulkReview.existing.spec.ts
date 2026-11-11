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
import config from "@/aws-exports";
import { queryClient } from "@/composables/query/queryClient";
import type { BulkRow } from "./useBulkReview";

const api = vi.hoisted(() => ({
  folders: vi.fn(),
  schema: vi.fn(),
  alerts: vi.fn(),
}));

vi.mock("@/services/common", () => ({ default: { list_Folders: api.folders } }));
vi.mock("@/services/stream", () => ({ default: { schema: api.schema } }));
vi.mock("@/services/alerts", () => ({ default: { listByFolderId: api.alerts } }));
vi.mock("../targets/baseline", () => ({ measureBaseline: vi.fn(async () => null) }));

const { closeBulkReview, isTickable, loadReviewContext, openBulkReview, useBulkReview } =
  await import("./useBulkReview");
const { findExisting, checkKeyOf } = await import("./existingAlerts");

const original = config.isEnterprise;
const review = useBulkReview();
const ORG = "demo-org";

const noData = (service: string, stream = "fresh_l"): BulkRow => ({
  key: `${service}:no_data`,
  kind: "no_data",
  scope: { service, cluster: null, namespace: null, stream: { type: "logs", name: stream } },
  usually: null,
  team: {
    name: "ops",
    folderId: "f-ops",
    folderName: "ops",
    source: "folder",
    reason: "" as never,
  },
});

const listed = (over: Record<string, unknown>) => ({
  alert_id: "3Lwzv4Am8XjWhczJYN0m32tpiUK",
  name: "svc-fresh-l-no-data",
  folder_id: "f-ops",
  folder_name: "ops",
  stream_type: "logs",
  stream_name: "fresh_l",
  condition: {
    sql: `SELECT count(*) AS rows_seen FROM "fresh_l" WHERE "service_name" = 'svc-fresh-l' HAVING count(*) = 0`,
  },
  ...over,
});

const rowOf = (key: string) => review.reviewRows.value.find((r) => r.key === key)!;

beforeEach(() => {
  config.isEnterprise = "true";
  queryClient.clear();
  api.folders
    .mockReset()
    .mockResolvedValue({ data: { list: [{ folderId: "f-ops", name: "ops" }] } });
  api.schema.mockReset().mockResolvedValue({ data: { schema: [{ name: "service_name" }] } });
  api.alerts.mockReset().mockResolvedValue({ data: { list: [] } });
});

afterEach(() => {
  closeBulkReview();
  config.isEnterprise = original;
});

describe("the review marks drafts whose alert the org already has", () => {
  it("marks a draft with the same name in the same folder as already added, unticked", async () => {
    api.alerts.mockResolvedValue({ data: { list: [listed({})] } });
    openBulkReview({ kind: "no_data", rows: [noData("svc-fresh-l"), noData("svc-new", "new_l")] });
    await loadReviewContext(ORG);
    const added = rowOf("svc-fresh-l:no_data");
    expect(added.block).toMatchObject({
      code: "exists",
      alert: { id: "3Lwzv4Am8XjWhczJYN0m32tpiUK", folderName: "ops" },
    });
    expect(isTickable(added)).toBe(false);
    expect(review.state.ticked.has(added.key)).toBe(false);
    expect(review.toCreate.value.map((r) => r.key)).toEqual(["svc-new:no_data"]);
  });

  it("marks a draft whose stream and query an alert in another folder already runs", async () => {
    api.alerts.mockResolvedValue({
      data: { list: [listed({ name: "my own check", folder_id: "f-pay", folder_name: "pay" })] },
    });
    openBulkReview({ kind: "no_data", rows: [noData("svc-fresh-l")] });
    await loadReviewContext(ORG);
    expect(rowOf("svc-fresh-l:no_data").block).toMatchObject({
      code: "exists",
      alert: { name: "my own check", folderName: "pay" },
    });
    expect(review.toCreate.value).toHaveLength(0);
  });

  it("waits for the alerts list before anything can be added", async () => {
    let answer!: (v: unknown) => void;
    api.alerts.mockReturnValue(new Promise((r) => (answer = r)));
    openBulkReview({ kind: "no_data", rows: [noData("svc-fresh-l")] });
    const loading = loadReviewContext(ORG);
    await Promise.resolve();
    expect(rowOf("svc-fresh-l:no_data").block).toEqual({ code: "checking" });
    expect(review.toCreate.value).toHaveLength(0);
    answer({ data: { list: [] } });
    await loading;
    expect(review.toCreate.value).toHaveLength(1);
  });

  it("adds nothing when the alerts list can't be read, and says why", async () => {
    api.alerts.mockRejectedValue(new Error("403"));
    openBulkReview({ kind: "no_data", rows: [noData("svc-fresh-l")] });
    await loadReviewContext(ORG);
    expect(rowOf("svc-fresh-l:no_data").block).toEqual({ code: "existsFailed" });
    expect(review.toCreate.value).toHaveLength(0);
  });

  it("reads the list fresh on every open, so another tab's add is seen", async () => {
    openBulkReview({ kind: "no_data", rows: [noData("svc-fresh-l")] });
    await loadReviewContext(ORG);
    expect(review.toCreate.value).toHaveLength(1);
    api.alerts.mockResolvedValue({ data: { list: [listed({})] } });
    openBulkReview({ kind: "no_data", rows: [noData("svc-fresh-l")] });
    await loadReviewContext(ORG);
    expect(review.toCreate.value).toHaveLength(0);
    expect(api.alerts).toHaveBeenCalledTimes(2);
    expect(api.alerts.mock.calls[0][6]).toBe("");
  });
});

describe("findExisting", () => {
  const alert = {
    id: "a1",
    name: "svc-b-errors",
    folderId: "f-ops",
    folderName: "ops",
    streamType: "traces",
    streamName: "app_traces",
    sql: `SELECT count(*) AS errors FROM "app_traces" WHERE "service_name" = 'svc-b' AND "span_status" = 'ERROR' HAVING count(*) > 12`,
  };

  it("matches the same check with a re-measured threshold", () => {
    expect(
      findExisting([alert], {
        name: "other",
        folderId: "f-x",
        streamType: "traces",
        streamName: "app_traces",
        sql: `select count(*) as errors from app_traces where service_name = 'svc-b' and span_status = 'ERROR' having count(*) > 30`,
      }),
    ).toBe(alert);
  });

  it("does not match the same name in another folder, or another service's query", () => {
    expect(
      findExisting([alert], {
        name: "svc-b-errors",
        folderId: "f-pay",
        streamType: "traces",
        streamName: "app_traces",
        sql: alert.sql.replace("svc-b", "svc-c"),
      }),
    ).toBeNull();
    expect(checkKeyOf(alert.sql)).toMatch(/^count_above /);
  });
});

describe("a row still reading its stream fields", () => {
  it("is not matched on its provisional query, so it stays ticked once its real query differs", async () => {
    let fields!: (v: unknown) => void;
    api.schema.mockReturnValue(new Promise((r) => (fields = r)));
    api.alerts.mockResolvedValue({
      data: {
        list: [
          listed({
            name: "svc-a-no-data",
            stream_name: "app_logs",
            condition: {
              sql: `SELECT count(*) AS rows_seen FROM "app_logs" WHERE "service_name" = 'svc-a' HAVING count(*) = 0`,
            },
          }),
        ],
      },
    });
    const inNs: BulkRow = {
      ...noData("svc-a", "app_logs"),
      key: "svc-a-ns-b:no_data",
      scope: {
        service: "svc-a",
        cluster: null,
        namespace: "ns-b",
        stream: { type: "logs", name: "app_logs" },
      },
    };
    openBulkReview({ kind: "no_data", rows: [inNs] });
    const loading = loadReviewContext(ORG);
    await new Promise((r) => setTimeout(r, 0));
    expect(rowOf("svc-a-ns-b:no_data").block).toEqual({ code: "checking" });
    fields({ data: { schema: [{ name: "service_name" }, { name: "k8s_namespace_name" }] } });
    await loading;
    expect(rowOf("svc-a-ns-b:no_data").block).toBeNull();
    expect(review.toCreate.value.map((r) => r.key)).toEqual(["svc-a-ns-b:no_data"]);
  });
});
