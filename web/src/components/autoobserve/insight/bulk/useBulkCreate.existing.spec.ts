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
import { createMemoryHistory, createRouter } from "vue-router";
import config from "@/aws-exports";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { TranslateFn } from "@/types/i18n";
import { queryClient } from "@/composables/query/queryClient";
import { m12Rows } from "./bulkFixtures";
import { serviceKeyOf, useRecentlyCreated } from "./useRecentlyCreated";
import { applyExisting, closeBulkReview, openBulkReview, useBulkReview } from "./useBulkReview";

const api = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/alerts", () => ({
  default: { create_by_alert_id: api.create, listByFolderId: api.list },
}));

vi.mock("@/lib/feedback/Toast/useToast", async (load) => ({
  ...(await load<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: api.toast,
}));

const { useBulkCreate } = await import("./useBulkCreate");

const t = i18n.global.t as unknown as TranslateFn;
const original = config.isEnterprise;
const review = useBulkReview();
const recently = useRecentlyCreated();
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/a", component: { template: "<div />" } }],
});

const makeCreate = () =>
  useBulkCreate({
    org: () => "demo-org",
    store,
    router,
    t,
    locale: () => "en-US",
    floorMinutes: () => 1,
  });

beforeEach(async () => {
  config.isEnterprise = "true";
  queryClient.clear();
  api.create
    .mockReset()
    .mockImplementation((_o: string, body: any) =>
      Promise.resolve({ data: { id: `id-${body.name}` } }),
    );
  api.list.mockReset().mockResolvedValue({ data: { list: [] } });
  api.toast.mockReset().mockImplementation(() => Object.assign(vi.fn(), { id: "1" }));
  await router.push("/a");
  openBulkReview({ kind: "no_data", rows: m12Rows({ ingest: "f-ingest", payments: "f-pay" }) });
  applyExisting([]);
});

afterEach(() => {
  closeBulkReview();
  config.isEnterprise = original;
  recently.clearOnPass("demo-org", Number.MAX_SAFE_INTEGER);
});

describe("Add re-checks the org's alerts right before creating", () => {
  it("skips a draft another tab added meanwhile and says how many it skipped", async () => {
    const rows = review.toCreate.value;
    const taken = rows[0];
    api.list.mockResolvedValue({
      data: {
        list: [
          {
            alert_id: "existing-1",
            name: taken.prefill!.name,
            folder_id: taken.folder.id,
            folder_name: taken.folder.name,
            stream_type: taken.stream.type,
            stream_name: taken.stream.name,
            condition: { sql: taken.prefill!.sql },
          },
        ],
      },
    });
    const { create, results } = makeCreate();
    await create("no_data", rows);
    const sent = api.create.mock.calls.map((c) => c[1].name);
    expect(sent).not.toContain(taken.prefill!.name);
    expect(sent).toHaveLength(rows.length - 1);
    expect(results[taken.key]).toEqual({ status: "exists", id: "existing-1" });
    expect(String(api.toast.mock.calls.at(-1)?.[0].message)).toContain(
      "1 already existed and was skipped.",
    );
    const key = serviceKeyOf("demo-org", taken.service, taken.cluster, taken.namespace);
    expect(recently.has(key, "no_data")).toBe(true);
  });

  it("creates nothing when every draft already exists, and offers no Undo", async () => {
    const rows = review.toCreate.value.slice(0, 2);
    api.list.mockResolvedValue({
      data: {
        list: rows.map((r, i) => ({
          alert_id: `e-${i}`,
          name: r.prefill!.name,
          folder_id: r.folder.id,
          folder_name: r.folder.name,
          stream_type: r.stream.type,
          stream_name: r.stream.name,
          condition: { sql: r.prefill!.sql },
        })),
      },
    });
    const { create } = makeCreate();
    await create("no_data", rows);
    expect(api.create).not.toHaveBeenCalled();
    const shown = api.toast.mock.calls.at(-1)?.[0];
    expect(String(shown.message)).toBe("2 already existed and were skipped.");
    expect(shown.action).toBeUndefined();
  });
});

describe("Retry re-checks the org's alerts first", () => {
  it("skips a draft whose timed-out POST did create it, and says so", async () => {
    const rows = review.toCreate.value.slice(0, 2);
    const [lost, kept] = rows;
    api.create.mockImplementation((_o: string, body: any) =>
      body.name === lost.prefill!.name
        ? Promise.reject({ code: "ECONNABORTED" })
        : Promise.resolve({ data: { id: `id-${body.name}` } }),
    );
    const { create, retry, results } = makeCreate();
    await create("no_data", rows);
    expect(results[lost.key]).toMatchObject({ status: "failed", retryable: true });
    expect(results[kept.key]).toMatchObject({ status: "created" });
    api.list.mockResolvedValue({
      data: {
        list: [
          {
            alert_id: "landed-1",
            name: lost.prefill!.name,
            folder_id: lost.folder.id,
            folder_name: lost.folder.name,
            stream_type: lost.stream.type,
            stream_name: lost.stream.name,
            condition: { sql: lost.prefill!.sql },
          },
        ],
      },
    });
    api.create.mockClear();
    api.toast.mockClear();
    await retry([lost.key]);
    expect(api.create).not.toHaveBeenCalled();
    expect(results[lost.key]).toEqual({ status: "exists", id: "landed-1" });
    expect(String(api.toast.mock.calls.at(-1)?.[0].message)).toContain(
      "1 already existed and was skipped.",
    );
  });

  it("says the skipped count once, not again when the review closes", async () => {
    const rows = review.toCreate.value.slice(0, 1);
    api.create.mockRejectedValueOnce({ code: "ECONNABORTED" });
    const { create, retry, showUndo } = makeCreate();
    await create("no_data", rows);
    api.list.mockResolvedValue({
      data: {
        list: [
          {
            alert_id: "landed-2",
            name: rows[0].prefill!.name,
            folder_id: rows[0].folder.id,
            folder_name: rows[0].folder.name,
            stream_type: rows[0].stream.type,
            stream_name: rows[0].stream.name,
            condition: { sql: rows[0].prefill!.sql },
          },
        ],
      },
    });
    api.toast.mockClear();
    await retry([rows[0].key]);
    showUndo();
    const skipped = api.toast.mock.calls.filter(([o]) =>
      String(o.message).includes("already existed"),
    );
    expect(skipped).toHaveLength(1);
  });

  it("re-sends a draft the org still doesn't have", async () => {
    const rows = review.toCreate.value.slice(0, 1);
    api.create.mockRejectedValueOnce({ code: "ECONNABORTED" });
    const { create, retry, results } = makeCreate();
    await create("no_data", rows);
    expect(results[rows[0].key]).toMatchObject({ status: "failed", retryable: true });
    api.create.mockClear();
    await retry([rows[0].key]);
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(results[rows[0].key]).toMatchObject({ status: "created" });
  });
});
