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
import { dismissAll, toastRecords } from "@/lib/feedback/Toast/useToast";
import type { TranslateFn } from "@/types/i18n";
import { m12Rows } from "./bulkFixtures";
import { serviceKeyOf, useRecentlyCreated } from "./useRecentlyCreated";
import {
  applyExisting,
  closeBulkReview,
  openBulkReview,
  useBulkReview,
  type ReviewRow,
} from "./useBulkReview";

const api = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn() }));

vi.mock("@/services/alerts", () => ({
  default: { create_by_alert_id: api.create, delete_by_alert_id: api.remove },
}));

const { useBulkCreate } = await import("./useBulkCreate");

const IDS = { ingest: "f-ingest", payments: "f-pay" };
const t = i18n.global.t as unknown as TranslateFn;
const original = config.isEnterprise;
const review = useBulkReview();
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/a", component: { template: "<div />" } }],
});

let org = "org-a";
const makeCreate = () =>
  useBulkCreate({
    org: () => org,
    store,
    router,
    t,
    locale: () => "en-US",
    floorMinutes: () => 1,
  });

const ok = (id: string) => Promise.resolve({ data: { id } });
const timeout = () => Promise.reject(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));
const ticked = (): ReviewRow[] => review.toCreate.value;
const undoToasts = () => toastRecords.filter((r) => r.open && r.action);
const clickUndo = () => {
  const shown = undoToasts();
  expect(shown).toHaveLength(1);
  shown[0].action!.handler();
};
const orgsOf = (mock: typeof api.create) => [...new Set(mock.mock.calls.map((c) => c[0]))];

/** Holds every call of `mock` until the test resolves it. */
const holdCalls = (mock: typeof api.create, idOf: (args: any[]) => string) => {
  const pending: (() => void)[] = [];
  mock.mockImplementation(
    (...args: any[]) =>
      new Promise((resolve) => pending.push(() => resolve({ data: { id: idOf(args) } }))),
  );
  return {
    pending,
    releaseAll: async () => {
      while (pending.length) {
        pending.shift()!();
        await flushPromises();
      }
    },
  };
};

const waitForCalls = async (mock: typeof api.create, count: number) => {
  for (let i = 0; i < 50 && mock.mock.calls.length < count; i++) await flushPromises();
  expect(mock).toHaveBeenCalledTimes(count);
};

beforeEach(async () => {
  config.isEnterprise = "true";
  org = "org-a";
  api.create.mockReset();
  api.remove.mockReset().mockResolvedValue({ data: {} });
  await router.push("/a");
  openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
  applyExisting([]);
});

afterEach(() => {
  closeBulkReview();
  dismissAll();
  config.isEnterprise = original;
});

describe("useBulkCreate — the org is fixed for the whole action", () => {
  it("sends nothing to the new org when the user switches while payloads are being built", async () => {
    api.create.mockImplementation((_o: string, body: any) => ok(`id-${body.name}`));
    const run = makeCreate().create("no_data", ticked());
    org = "org-b";
    await run;
    expect(orgsOf(api.create)).not.toContain("org-b");
    expect(api.create).not.toHaveBeenCalled();
  });

  it("stops the queued creates after a switch; the ones in flight finish in the first org", async () => {
    const held = holdCalls(api.create, (args) => `id-${args[1].name}`);
    const run = makeCreate().create("no_data", ticked());
    await waitForCalls(api.create, 4);
    org = "org-b";
    await held.releaseAll();
    await run;
    expect(api.create).toHaveBeenCalledTimes(4);
    expect(orgsOf(api.create)).toEqual(["org-a"]);
  });

  it("stops scheduling creates once the review goes away", async () => {
    const held = holdCalls(api.create, (args) => `id-${args[1].name}`);
    const creator = makeCreate();
    const run = creator.create("no_data", ticked());
    await waitForCalls(api.create, 4);
    creator.expire();
    await held.releaseAll();
    await run;
    expect(api.create).toHaveBeenCalledTimes(4);
  });

  it("does not retry into another org", async () => {
    api.create.mockImplementation((_o: string, body: any) =>
      body.name === "svc-ingest-f-no-data" ? timeout() : ok(`id-${body.name}`),
    );
    const creator = makeCreate();
    await creator.create("no_data", ticked());
    api.create.mockClear();
    org = "org-b";
    await creator.retry(["ingest-f"]);
    expect(api.create).not.toHaveBeenCalled();
  });

  it("Undo deletes in the org the alerts were created in, even after a switch mid-Undo", async () => {
    api.create.mockImplementation((_o: string, body: any) => ok(`id-${body.name}`));
    await makeCreate().create("no_data", ticked());
    const held = holdCalls(api.remove, (args) => args[1]);
    clickUndo();
    await waitForCalls(api.remove, 4);
    org = "org-b";
    await held.releaseAll();
    expect(api.remove).toHaveBeenCalledTimes(11);
    expect(orgsOf(api.remove)).toEqual(["org-a"]);
  });

  it("records the created services under the org they were created in", async () => {
    api.create.mockImplementation((_o: string, body: any) => ok(`id-${body.name}`));
    await makeCreate().create("no_data", ticked());
    const recent = useRecentlyCreated();
    expect(recent.has(serviceKeyOf("org-a", "svc-ingest-b", null, null), "no_data")).toBe(true);
    expect(recent.has(serviceKeyOf("org-b", "svc-ingest-b", null, null), "no_data")).toBe(false);
  });
});

describe("useBulkCreate — Undo and Retry never miss each other", () => {
  const createWithOneTimeout = async () => {
    api.create.mockImplementation((_o: string, body: any) =>
      body.name === "svc-ingest-f-no-data" ? timeout() : ok(`id-${body.name}`),
    );
    const creator = makeCreate();
    await creator.create("no_data", ticked());
    api.create.mockReset();
    return creator;
  };

  it("Undo during a retry waits for it and deletes the alert the retry created", async () => {
    const creator = await createWithOneTimeout();
    const held = holdCalls(api.create, () => "id-retried");
    const retried = creator.retry(["ingest-f"]);
    await waitForCalls(api.create, 1);
    clickUndo();
    await flushPromises();
    await held.releaseAll();
    await retried;
    await flushPromises();
    const ids = api.remove.mock.calls.map((c) => c[1]);
    expect(ids).toContain("id-retried");
    expect(ids).toHaveLength(11);
    expect(undoToasts()).toHaveLength(0);
  });

  it("Undo while a retry's payload is being built sends no create", async () => {
    const creator = await createWithOneTimeout();
    api.create.mockImplementation(() => ok("id-retried"));
    const retried = creator.retry(["ingest-f"]);
    clickUndo();
    await retried;
    await flushPromises();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.remove).toHaveBeenCalledTimes(10);
  });
});

describe("useBulkCreate — one Undo per page (real toasts)", () => {
  it("a second batch joins the first batch's Undo instead of hiding behind an identical toast", async () => {
    api.create.mockImplementation((_o: string, body: any) => ok(`id-${body.name}`));
    const creator = makeCreate();
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS).slice(0, 1) });
    applyExisting([]);
    await creator.create("no_data", ticked());
    creator.reset();
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS).slice(1, 2) });
    applyExisting([]);
    await creator.create("no_data", ticked());
    expect(undoToasts()).toHaveLength(1);
    expect(undoToasts()[0].message).toBe(
      "2 alerts created in folder ingest. Undo works until you leave this page.",
    );
    clickUndo();
    await flushPromises();
    expect(api.remove.mock.calls.map((c) => c[1]).sort()).toEqual([
      "id-svc-ingest-b-no-data",
      "id-svc-ingest-c-no-data",
    ]);
  });
});
