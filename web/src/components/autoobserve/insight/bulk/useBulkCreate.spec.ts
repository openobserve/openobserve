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
import { createMemoryHistory, createRouter } from "vue-router";
import config from "@/aws-exports";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { isPrefillBlocked, normalizePrefill } from "@/utils/alerts/alertPrefill";
import type { TranslateFn } from "@/types/i18n";
import { m12Rows } from "./bulkFixtures";
import { queryClient } from "@/composables/query/queryClient";
import { autoobserveKeys } from "@/services/autoobserve.querykeys";
import { useRecentlyCreated, serviceKeyOf } from "./useRecentlyCreated";
import {
  applyExisting,
  applyRights,
  closeBulkReview,
  openBulkReview,
  useBulkReview,
  type ReviewRow,
} from "./useBulkReview";

const api = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/alerts", () => ({
  default: {
    create_by_alert_id: api.create,
    delete_by_alert_id: api.remove,
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", async (load) => ({
  ...(await load<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: api.toast,
}));

const { CONCURRENCY, failureOf, useBulkCreate } = await import("./useBulkCreate");

const IDS = { ingest: "f-ingest", payments: "f-pay" };
const t = i18n.global.t as unknown as TranslateFn;
const original = config.isEnterprise;
const review = useBulkReview();

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/a", component: { template: "<div />" } },
    { path: "/b", component: { template: "<div />" } },
  ],
});

let toastId = 0;
const makeCreate = () =>
  useBulkCreate({
    org: () => "demo-org",
    store,
    router,
    t,
    locale: () => "en-US",
    floorMinutes: () => 1,
  });

const okFor = (id: string) => Promise.resolve({ data: { id, name: id, code: 200 } });
const httpError = (status: number, data: any = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

const ticked = (): ReviewRow[] => review.toCreate.value;
const lastToast = () => api.toast.mock.calls.at(-1)?.[0];
const bodyFolder = (call: any[]) => call[2];

beforeEach(async () => {
  config.isEnterprise = "true";
  api.create.mockReset();
  api.remove.mockReset().mockResolvedValue({ data: {} });
  api.toast.mockReset().mockImplementation(() => {
    const id = String(++toastId);
    return Object.assign(vi.fn(), { id });
  });
  await router.push("/a");
  openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
  applyExisting([]);
});

afterEach(() => {
  closeBulkReview();
  config.isEnterprise = original;
});

describe("useBulkCreate — create", () => {
  it("sends one POST per ticked row and none for unticked rows", async () => {
    api.create.mockImplementation((_org: string, body: any) => okFor(body.name));
    const { create } = makeCreate();
    await create("no_data", ticked());
    expect(api.create).toHaveBeenCalledTimes(11);
    const names = api.create.mock.calls.map((c) => c[1].name);
    expect(names).not.toContain("svc-a-no-data");
    expect(new Set(names).size).toBe(11);
  });

  it("keeps at most four requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    api.create.mockImplementation(async (_org: string, body: any) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return { data: { id: body.name } };
    });
    const { create } = makeCreate();
    await create("no_data", ticked());
    expect(CONCURRENCY).toBe(4);
    expect(peak).toBe(4);
  });

  it("saves each row to its own folder, as the folder query parameter and in the body", async () => {
    api.create.mockImplementation((_org: string, body: any) => okFor(body.name));
    await makeCreate().create("no_data", ticked());
    const byName = Object.fromEntries(api.create.mock.calls.map((c) => [c[1].name, c]));
    expect(bodyFolder(byName["svc-ingest-b-no-data"])).toBe("f-ingest");
    expect(byName["svc-ingest-b-no-data"][1].folder_id).toBe("f-ingest");
    expect(bodyFolder(byName["svc-j-no-data"])).toBe("f-pay");
    expect(bodyFolder(byName["svc-a-ns-b-no-data"])).toBe("default");
  });

  it("builds payloads that pass the prefill contract and carry the origin line", async () => {
    api.create.mockImplementation((_org: string, body: any) => okFor(body.name));
    await makeCreate().create("no_data", ticked());
    for (const row of ticked()) {
      expect(isPrefillBlocked(normalizePrefill(row.prefill!))).toBe(false);
    }
    for (const [, body] of api.create.mock.calls) {
      expect(body.description).toMatch(/^Created from an AutoObserve suggestion for /);
      expect(body.query_condition.sql).toMatch(/HAVING count\(\*\) = 0$/);
      expect(body.query_condition.aggregation).toBeNull();
      expect(body.trigger_condition).toMatchObject({ period: 15, threshold: 1, operator: ">=" });
      expect(body.is_real_time).toBe(false);
      expect(body.creates_incident).toBe(true);
    }
    const ingest = api.create.mock.calls.find((c) => c[1].name === "svc-ingest-b-no-data")!;
    expect(ingest[1].destinations).toEqual(["ingest-oncall"]);
    expect(ingest[3]).toEqual({ silentForbidden: true, timeout: 30_000 });
  });

  it("closes the review and offers Undo in one toast when all succeed", async () => {
    applyRights({ "f-pay": false });
    api.create.mockImplementation((_org: string, body: any) => okFor(body.name));
    await makeCreate().create("no_data", ticked());
    expect(api.create).toHaveBeenCalledTimes(8);
    expect(review.state.open).toBe(false);
    expect(api.toast).toHaveBeenCalledTimes(1);
    expect(lastToast().message).toBe(
      "8 alerts created in folders ingest and default. Undo works until you leave this page.",
    );
    expect(lastToast().action.label).toBe("Undo");
    expect(lastToast().timeout).toBe(0);
  });

  it("records the created services until the next analysis pass", async () => {
    api.create.mockImplementation((_org: string, body: any) => okFor(body.name));
    const before = Date.now();
    await makeCreate().create("no_data", ticked());
    const recent = useRecentlyCreated();
    const key = serviceKeyOf("demo-org", "svc-ingest-b", null, null);
    expect(recent.has(key, "no_data")).toBe(true);
    expect(recent.has(key, "errors")).toBe(false);
    recent.clearOnPass("demo-org", before - 1);
    expect(recent.has(key, "no_data")).toBe(true);
    recent.clearOnPass("demo-org", Date.now());
    expect(recent.has(key, "no_data")).toBe(false);
  });
});

describe("useBulkCreate — coverage follows the add (COVERAGE-AFTER-ADD)", () => {
  const invalidated = () =>
    (spy.mock.calls as unknown as [{ queryKey: unknown[] }][]).map(([f]) => f.queryKey);
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  });
  afterEach(() => spy.mockRestore());

  it("refetches coverage and the gap suggestions once after Add, not once per alert", async () => {
    api.create.mockImplementation((_org: string, body: any) => okFor(body.name));
    await makeCreate().create("no_data", ticked());
    expect(invalidated()).toEqual([
      autoobserveKeys.coverageAll("demo-org"),
      autoobserveKeys.suggestions("demo-org"),
    ]);
  });

  it("refetches them again after Undo", async () => {
    api.create.mockImplementation((_org: string, body: any) => okFor(`id-${body.name}`));
    await makeCreate().create("no_data", ticked());
    spy.mockClear();
    lastToast().action.handler();
    await flushPromises();
    expect(invalidated()).toHaveLength(2);
  });
});

describe("useBulkCreate — undo", () => {
  it("deletes exactly the ids this action created, by id and folder", async () => {
    api.create.mockImplementation((_org: string, body: any) => okFor(`id-${body.name}`));
    await makeCreate().create("no_data", ticked());
    lastToast().action.handler();
    await flushPromises();
    const deleted = api.remove.mock.calls.map((c) => [c[1], c[2]]);
    expect(deleted).toHaveLength(11);
    expect(deleted).toContainEqual(["id-svc-ingest-b-no-data", "f-ingest"]);
    expect(deleted.every(([id]) => String(id).startsWith("id-"))).toBe(true);
    expect(lastToast().message).toBe("11 alerts removed.");
  });

  it("never deletes an alert this action did not create", async () => {
    api.create.mockImplementation((_org: string, body: any) =>
      body.name === "svc-ingest-c-no-data"
        ? Promise.reject(httpError(409, { message: "Alert already exists" }))
        : okFor(`id-${body.name}`),
    );
    const creator = makeCreate();
    await creator.create("no_data", ticked());
    lastToast().action.handler();
    await flushPromises();
    const ids = api.remove.mock.calls.map((c) => c[1]);
    expect(ids).toHaveLength(10);
    expect(ids.some((id: string) => id.includes("svc-ingest-c"))).toBe(false);
    await creator.undo();
    expect(api.remove).toHaveBeenCalledTimes(10);
  });

  it("offers no Undo after the user moves to another page, and deletes nothing later", async () => {
    api.create.mockImplementation((_org: string, body: any) => okFor(`id-${body.name}`));
    const creator = makeCreate();
    await creator.create("no_data", ticked());
    const shown = api.toast.mock.results.at(-1)!.value;
    const undoAction = lastToast().action.handler;
    await router.push("/b");
    await flushPromises();
    expect(shown).toHaveBeenCalled();
    undoAction();
    await creator.undo();
    await flushPromises();
    expect(api.remove).not.toHaveBeenCalled();
  });
});

describe("useBulkCreate — partial failure", () => {
  it("names the folder on a 403 and offers no retry", async () => {
    api.create.mockImplementation((_org: string, body: any) =>
      body.name === "svc-j-no-data" ? Promise.reject(httpError(403)) : okFor(body.name),
    );
    const { create, results } = makeCreate();
    await create("no_data", ticked());
    expect(results.j).toMatchObject({
      status: "failed",
      retryable: false,
      reason: { code: "forbidden", folder: "payments" },
    });
    expect(review.state.open).toBe(true);
  });

  it("names the existing alert on a duplicate and offers no retry", () => {
    const job = { folder: { id: "f-ops", name: "ops" }, name: "svc-a-ns-j-no-data" };
    expect(failureOf(httpError(409), job)).toEqual({
      reason: { code: "duplicate", name: "svc-a-ns-j-no-data", folder: "ops" },
      retryable: false,
    });
    expect(failureOf(httpError(500, { message: "UNIQUE constraint failed" }), job).retryable).toBe(
      false,
    );
  });

  it("retries a timed-out row, and only that row", async () => {
    let first = true;
    api.create.mockImplementation((_org: string, body: any) => {
      if (body.name === "svc-ingest-f-no-data" && first) {
        first = false;
        return Promise.reject(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));
      }
      return okFor(body.name);
    });
    const { create, retry, results } = makeCreate();
    await create("no_data", ticked());
    expect(results["ingest-f"]).toMatchObject({
      status: "failed",
      retryable: true,
      reason: { code: "timeout" },
    });
    api.create.mockClear();
    await retry(Object.keys(results));
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create.mock.calls[0][1].name).toBe("svc-ingest-f-no-data");
    expect(results["ingest-f"].status).toBe("created");
    expect(review.state.open).toBe(false);
  });

  it("never re-sends a created row, nor a row whose failure retry cannot help", async () => {
    api.create.mockImplementation((_org: string, body: any) =>
      body.name === "svc-j-no-data" ? Promise.reject(httpError(403)) : okFor(body.name),
    );
    const { create, retry, results } = makeCreate();
    await create("no_data", ticked());
    api.create.mockClear();
    await retry(Object.keys(results));
    expect(api.create).not.toHaveBeenCalled();
  });

  it("maps server outages to a retry and a bad request to a reason", () => {
    const job = { folder: { id: "f", name: "ops" }, name: "x" };
    expect(failureOf(httpError(503), job)).toMatchObject({ retryable: true });
    expect(failureOf(new Error("Network Error"), job)).toMatchObject({
      reason: { code: "timeout" },
      retryable: true,
    });
    expect(failureOf(httpError(400), job)).toEqual({
      reason: { code: "invalid" },
      retryable: false,
    });
    expect(failureOf(httpError(404), job).reason).toEqual({ code: "missing" });
  });
});
