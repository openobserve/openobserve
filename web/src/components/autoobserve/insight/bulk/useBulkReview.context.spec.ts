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
import { flushPromises } from "@vue/test-utils";
import config from "@/aws-exports";
import type { BulkRow } from "./useBulkReview";

const api = vi.hoisted(() => ({
  folders: vi.fn(),
  destinations: vi.fn(),
  schema: vi.fn(),
  alerts: vi.fn(),
}));

vi.mock("@/services/common", () => ({ default: { list_Folders: api.folders } }));
vi.mock("@/services/alert_destination", () => ({ default: { list: api.destinations } }));
vi.mock("@/services/stream", () => ({ default: { schema: api.schema } }));
vi.mock("@/services/alerts", () => ({ default: { listByFolderId: api.alerts } }));
const measureBaseline = vi.hoisted(() => vi.fn());
vi.mock("../targets/baseline", () => ({
  measureBaseline: (...a: unknown[]) => measureBaseline(...a),
}));

const {
  closeBulkReview,
  isCreatable,
  loadDestinations,
  loadReviewContext,
  openBulkReview,
  setFolderRightsSource,
  setRowThreshold,
  useBulkReview,
} = await import("./useBulkReview");

const original = config.isEnterprise;
const review = useBulkReview();

const row = (key: string, extra: Partial<BulkRow["scope"]> = {}): BulkRow => ({
  key,
  scope: {
    service: `svc-${key}`,
    cluster: null,
    namespace: null,
    stream: { type: "logs", name: "app_logs" },
    ...extra,
  } as BulkRow["scope"],
  usually: 100,
});

const rowOf = (key: string) => review.reviewRows.value.find((r) => r.key === key)!;
const fields = (...names: string[]) => ({ data: { schema: names.map((name) => ({ name })) } });
const folderList = (...names: string[]) => ({
  data: { list: names.map((name) => ({ folderId: `id-${name}`, name })) },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(() => {
  config.isEnterprise = "true";
  api.folders.mockReset().mockResolvedValue(folderList());
  api.destinations.mockReset().mockResolvedValue({ data: { list: [] } });
  api.schema.mockReset().mockResolvedValue(fields("service_name"));
  api.alerts.mockReset().mockResolvedValue({ data: { list: [] } });
  setFolderRightsSource(null);
  measureBaseline.mockReset();
});

afterEach(() => {
  closeBulkReview();
  config.isEnterprise = original;
});

describe("useBulkReview — scope fields are checked against the stream", () => {
  it("a row whose stream has no cluster field cannot be ticked and says which field is missing", () => {
    openBulkReview({
      kind: "no_data",
      rows: [row("a", { cluster: "c-1", schema: ["service_name", "k8s_namespace_name"] })],
    });
    expect(isCreatable(rowOf("a"))).toBe(false);
    expect(rowOf("a").block).toEqual({ code: "noField", part: "cluster", value: "c-1" });
    expect(review.state.ticked.has("a")).toBe(false);
    expect(review.toCreate.value).toHaveLength(0);
  });

  it("a row whose stream has no service field cannot be ticked", () => {
    openBulkReview({ kind: "no_data", rows: [row("a", { schema: ["message"] })] });
    expect(rowOf("a").block).toEqual({ code: "noField", part: "service", value: "svc-a" });
  });

  it("reads each stream's fields once when rows bring none, and waits for them", async () => {
    const answer = deferred<ReturnType<typeof fields>>();
    api.schema.mockReturnValue(answer.promise);
    openBulkReview({
      kind: "no_data",
      rows: [row("a", { namespace: "ns-1" }), row("b", { namespace: "ns-2" })],
    });
    const loading = loadReviewContext("org-a");
    expect(rowOf("a").block).toEqual({ code: "checking" });
    expect(review.toCreate.value).toHaveLength(0);
    answer.resolve(fields("service_name", "k8s_namespace_name"));
    await loading;
    expect(api.schema).toHaveBeenCalledTimes(1);
    expect(api.schema.mock.calls[0].slice(0, 3)).toEqual(["org-a", "app_logs", "logs"]);
    expect(review.toCreate.value.map((r) => r.key)).toEqual(["a", "b"]);
    expect(rowOf("a").prefill?.sql).toContain(`"k8s_namespace_name" = 'ns-1'`);
  });

  it("unticks a row once the stream's fields show it lacks the cluster field", async () => {
    api.schema.mockResolvedValue(fields("service_name"));
    openBulkReview({ kind: "no_data", rows: [row("a", { cluster: "c-1" }), row("b")] });
    await loadReviewContext("org-a");
    expect(rowOf("a").block).toEqual({ code: "noField", part: "cluster", value: "c-1" });
    expect(review.state.ticked.has("a")).toBe(false);
    expect(review.toCreate.value.map((r) => r.key)).toEqual(["b"]);
  });

  it("a stream whose fields cannot be read leaves its rows out, with the reason", async () => {
    api.schema.mockRejectedValue(new Error("HTTP 404"));
    openBulkReview({ kind: "no_data", rows: [row("a")] });
    await loadReviewContext("org-a");
    expect(rowOf("a").block).toEqual({ code: "schemaFailed" });
    expect(review.state.ticked.has("a")).toBe(false);
  });
});

describe("useBulkReview — review state belongs to one org", () => {
  const open = () =>
    openBulkReview({ kind: "no_data", rows: [row("a", { schema: ["service_name"] })] });

  it("offers each org its own destinations", async () => {
    api.destinations.mockImplementation(({ org_identifier }: any) =>
      Promise.resolve({ data: { list: [{ name: `${org_identifier}-oncall` }] } }),
    );
    open();
    await loadReviewContext("org-a");
    await loadDestinations("org-a");
    expect(review.state.destinations).toEqual(["org-a-oncall"]);
    open();
    await loadReviewContext("org-b");
    await loadDestinations("org-b");
    expect(review.state.destinations).toEqual(["org-b-oncall"]);
  });

  it("drops org A's folders when org B's folder list fails", async () => {
    api.folders.mockResolvedValueOnce(folderList("ingest"));
    open();
    await loadReviewContext("org-a");
    expect(review.state.folders.map((f) => f.name)).toEqual(["ingest"]);
    api.folders.mockRejectedValueOnce(new Error("HTTP 500"));
    open();
    await loadReviewContext("org-b");
    expect(review.state.folders).toEqual([]);
  });

  it("ignores folders, rights and destinations that answer after the user moved to another org", async () => {
    const lateFolders = deferred<ReturnType<typeof folderList>>();
    const lateRights = deferred<Record<string, boolean>>();
    const lateDestinations = deferred<any>();
    api.folders.mockReturnValueOnce(lateFolders.promise);
    setFolderRightsSource((o) => (o === "org-a" ? lateRights.promise : Promise.resolve(null)));
    api.destinations.mockReturnValueOnce(lateDestinations.promise);
    open();
    const contextA = loadReviewContext("org-a");
    const destinationsA = loadDestinations("org-a");
    api.folders.mockResolvedValueOnce(folderList("ops"));
    open();
    await loadReviewContext("org-b");
    lateFolders.resolve(folderList("ingest"));
    lateRights.resolve({ "id-ops": false });
    lateDestinations.resolve({ data: { list: [{ name: "org-a-oncall" }] } });
    await Promise.allSettled([contextA, destinationsA]);
    await flushPromises();
    expect(review.state.folders.map((f) => f.name)).toEqual(["ops"]);
    expect(review.state.rights).toBeNull();
    expect(review.state.destinations).toEqual([]);
  });
});

describe("useBulkReview — a threshold is measured over 7 days, else asked for (F1)", () => {
  const errorsRow = (key: string, usually: number | null): BulkRow => ({
    ...row(key),
    kind: "errors",
    usually,
  });

  it("measures each errors row with no usual level once the fields are read, and drafts on it", async () => {
    api.schema.mockResolvedValue(fields("service_name", "level"));
    measureBaseline.mockResolvedValue(5);
    openBulkReview({ kind: "errors", rows: [errorsRow("a", null), errorsRow("b", 10)] });
    expect(rowOf("a").block).toEqual({ code: "checking" });
    expect(review.state.ticked.has("a")).toBe(true);
    await loadReviewContext("org-a");
    await flushPromises();
    expect(measureBaseline).toHaveBeenCalledTimes(1);
    const [org, request] = measureBaseline.mock.calls[0];
    expect(org).toBe("org-a");
    expect(request).toMatchObject({ kind: "errors", stream: { type: "logs", name: "app_logs" } });
    expect(request.sql).toContain(`lower("level")`);
    expect(request.sql).not.toContain("HAVING");
    expect(rowOf("a").block).toBeNull();
    expect(rowOf("a").prefill?.sql).toMatch(/HAVING count\(\*\) > 15$/);
    expect(review.toCreate.value.map((r) => r.key).sort()).toEqual(["a", "b"]);
  });

  it("keeps an errors row the week gave no usual level ticked, firing on any error", async () => {
    api.schema.mockResolvedValue(fields("service_name", "level"));
    measureBaseline.mockResolvedValue(null);
    openBulkReview({ kind: "errors", rows: [errorsRow("a", null)] });
    await loadReviewContext("org-a");
    await flushPromises();
    expect(rowOf("a").block).toBeNull();
    expect(rowOf("a").threshold).toBe(0);
    expect(review.state.ticked.has("a")).toBe(true);
    expect(review.toCreate.value.map((r) => r.key)).toEqual(["a"]);
  });

  it("a cleared threshold unticks the row until one is set; clearing the reset goes back to any error", async () => {
    api.schema.mockResolvedValue(fields("service_name", "level"));
    measureBaseline.mockResolvedValue(null);
    openBulkReview({ kind: "errors", rows: [errorsRow("a", null)] });
    await loadReviewContext("org-a");
    await flushPromises();
    setRowThreshold("a", Number.NaN);
    expect(rowOf("a").block).toEqual({ code: "noBaseline", kind: "errors" });
    expect(review.state.ticked.has("a")).toBe(false);
    expect(review.toCreate.value).toEqual([]);
    setRowThreshold("a", 40);
    expect(rowOf("a").block).toBeNull();
    expect(review.state.ticked.has("a")).toBe(true);
    expect(rowOf("a").prefill?.sql).toMatch(/HAVING count\(\*\) > 40$/);
    setRowThreshold("a", null);
    expect(rowOf("a").threshold).toBe(0);
    expect(review.state.ticked.has("a")).toBe(true);
  });

  it("drops a measurement that lands after the review moved to another org", async () => {
    api.schema.mockResolvedValue(fields("service_name", "level"));
    const late = deferred<number | null>();
    measureBaseline.mockReturnValueOnce(late.promise);
    openBulkReview({ kind: "errors", rows: [errorsRow("a", null)] });
    const first = loadReviewContext("org-a");
    await flushPromises();
    openBulkReview({ kind: "errors", rows: [errorsRow("a", null)] });
    measureBaseline.mockResolvedValue(null);
    await loadReviewContext("org-b");
    late.resolve(5);
    await first;
    await flushPromises();
    expect(rowOf("a").usual).toBeNull();
    expect(rowOf("a").threshold).toBe(0);
  });
});

describe("useBulkReview — closing the review stops its measurements (F12)", () => {
  const errorsRow = (key: string): BulkRow => ({ ...row(key), kind: "errors", usually: null });

  it("starts no measurement when the review closes while the fields are still read", async () => {
    const schema = deferred<unknown>();
    api.schema.mockReturnValueOnce(schema.promise);
    openBulkReview({ kind: "errors", rows: [errorsRow("a")] });
    const load = loadReviewContext("org-a");
    await flushPromises();
    closeBulkReview();
    schema.resolve(fields("service_name", "level"));
    await load;
    await flushPromises();
    expect(measureBaseline).not.toHaveBeenCalled();
  });

  it("cancels the running batch and schedules no further one when the review closes", async () => {
    api.schema.mockResolvedValue(fields("service_name", "level"));
    const late = deferred<number | null>();
    measureBaseline.mockReturnValue(late.promise);
    const keys = ["a", "b", "c", "d", "e", "f"];
    openBulkReview({ kind: "errors", rows: keys.map(errorsRow) });
    const load = loadReviewContext("org-a");
    await flushPromises();
    expect(measureBaseline).toHaveBeenCalledTimes(4);
    closeBulkReview();
    const signals = measureBaseline.mock.calls.map((call) => call[2] as AbortSignal);
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
    late.resolve(5);
    await load;
    await flushPromises();
    expect(measureBaseline).toHaveBeenCalledTimes(4);
    expect(review.state.baselines).toEqual({});
  });
});
