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

// TDD spec for tmp/code.md Phase 5 item 20 (D9) — asking the server for values
// the cache has never seen.
//
// Today the two capture paths are byproducts of something the user already did:
// a Run Query, or expanding a field in the sidebar. A stream nobody has touched
// therefore has NO values, and the editor quietly offers the field list
// instead. Measured in the browser: metrics stream `cache_hit_ratio` gave
// nothing until it was searched once, after which it gave development/staging.
//
// The fetch lives HERE, next to the cache it fills, and not in the composable:
// whoever asks first pays for it, everyone else reads the result out of
// IndexedDB afterwards — including other surfaces, and the next session.
//
// In its own file because it needs @/services/stream mocked, and the existing
// fieldValueStore.spec.ts deliberately mocks only the DB layer.

import { describe, it, expect, vi, beforeEach } from "vitest";

// A DB that actually remembers. Asserting "mergeValues was called" would pin
// which writer the implementation picks; asserting the value comes back out
// pins what the caller can rely on.
const cached = vi.hoisted(() => new Map<string, string[]>());
vi.mock("@/composables/fieldValueDB", () => ({
  mergeValues: vi.fn(async (key: string, values: string[]) => {
    cached.set(key, [...new Set([...(cached.get(key) ?? []), ...values])]);
  }),
  mergeMultipleValues: vi.fn(async (entries: any[]) => {
    entries.forEach((e) =>
      cached.set(e.key, [...new Set([...(cached.get(e.key) ?? []), ...e.values])]),
    );
  }),
  getValues: vi.fn(async (key: string) => cached.get(key) ?? []),
  evictExpired: vi.fn().mockResolvedValue(0),
  trimToMaxFields: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/stream", () => ({
  default: { fieldValues: vi.fn() },
}));

import streamService from "@/services/stream";

/**
 * A fresh copy of the module per test.
 *
 * In-flight requests and the negative cache are module-level state by design —
 * they must be shared by every editor on the page — so tests cannot share a
 * copy. The alternative was exporting a `__reset` from production code, which
 * is a test seam sitting in the shipped API; this keeps the seam here.
 */
const freshStore = async () => {
  vi.resetModules();
  return await import("./fieldValueStore");
};

const ctx = { org: "myorg", streamType: "metrics", streamName: "cache_hit_ratio" };

/** The shape the values endpoint actually returns, verified against a live one. */
const apiResponse = (values: string[]) => ({
  data: {
    hits: [
      {
        field: "environment",
        values: values.map((v, i) => ({ zo_sql_key: v, zo_sql_num: 10 - i })),
      },
    ],
  },
});

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  vi.clearAllMocks();
  cached.clear();
  vi.mocked(streamService.fieldValues).mockResolvedValue(
    apiResponse(["development", "staging"]) as any,
  );
});

describe("requestFieldValues — asking the server", () => {
  it("returns the values it fetched", async () => {
    await expect((await freshStore()).requestFieldValues(ctx, "environment")).resolves.toEqual([
      "development",
      "staging",
    ]);
  });

  it("asks for the right stream, field and type", async () => {
    await (await freshStore()).requestFieldValues(ctx, "environment");
    const [args] = vi.mocked(streamService.fieldValues).mock.calls[0] as any[];
    expect(args.org_identifier).toBe("myorg");
    expect(args.stream_name).toBe("cache_hit_ratio");
    expect(args.fields).toEqual(["environment"]);
    // Without the type a metrics stream is looked up as logs and returns nothing.
    expect(args.type).toBe("metrics");
  });

  it("asks for the last fifteen minutes", async () => {
    await (await freshStore()).requestFieldValues(ctx, "environment");
    const [args] = vi.mocked(streamService.fieldValues).mock.calls[0] as any[];
    // Microseconds, as this endpoint takes them. Asserted as a WIDTH, because
    // the absolute values depend on when the test runs.
    const widthMinutes = (args.end_time - args.start_time) / 60_000_000;
    expect(widthMinutes).toBeCloseTo(15, 1);
    expect(args.end_time).toBeGreaterThan(args.start_time);
  });

  it("asks for few values, not a page of them", async () => {
    await (await freshStore()).requestFieldValues(ctx, "environment");
    const [args] = vi.mocked(streamService.fieldValues).mock.calls[0] as any[];
    // A dropdown shows a handful; the endpoint charges for the rest.
    expect(args.size).toBeGreaterThan(0);
    expect(args.size).toBeLessThanOrEqual(50);
  });

  it("leaves the values where the next READ will find them", async () => {
    // The real order matters and this test now follows it: the resolver reads
    // first (missing, so the 60-second read cache is primed with an EMPTY
    // list), and only then asks the server. An implementation that writes
    // straight to IndexedDB without invalidating that entry passes a test which
    // fetches before reading — and the user still sees nothing for a minute.
    const store = await freshStore();
    await expect(store.getFieldValuesForSuggestion(ctx, "environment")).resolves.toEqual([]);

    await store.requestFieldValues(ctx, "environment");
    await settle();

    await expect(store.getFieldValuesForSuggestion(ctx, "environment")).resolves.toEqual(
      expect.arrayContaining(["development", "staging"]),
    );
  });
});

describe("requestFieldValues — not asking twice", () => {
  it("makes ONE request when several editors ask at once", async () => {
    // Every keystroke re-invokes the provider. Without this, a slow endpoint
    // gets a request per character.
    const store = await freshStore();
    await Promise.all([
      store.requestFieldValues(ctx, "environment"),
      store.requestFieldValues(ctx, "environment"),
      store.requestFieldValues(ctx, "environment"),
    ]);
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(1);
  });

  it("does not ask again after an empty answer", async () => {
    // A field that genuinely has no values in the window must not be re-queried
    // on every keystroke for the rest of the session.
    vi.mocked(streamService.fieldValues).mockResolvedValue(apiResponse([]) as any);
    const store = await freshStore();
    await store.requestFieldValues(ctx, "environment");
    await store.requestFieldValues(ctx, "environment");
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(1);
  });

  it("does not ask again after a failure", async () => {
    vi.mocked(streamService.fieldValues).mockRejectedValue(new Error("500"));
    const store = await freshStore();
    await store.requestFieldValues(ctx, "environment");
    await store.requestFieldValues(ctx, "environment");
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(1);
  });

  it("asks again once the cooldown has passed", async () => {
    // Suppression has to expire. A permanent set also satisfies the two tests
    // above, and would disable a field's values for the rest of the session
    // after one transient 500 — or after one quiet fifteen-minute window, which
    // every field has at some hour of the night.
    vi.mocked(streamService.fieldValues).mockResolvedValue(apiResponse([]) as any);
    const store = await freshStore();
    await store.requestFieldValues(ctx, "environment");
    await store.requestFieldValues(ctx, "environment");
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(1);

    // Advancing the CLOCK rather than running timers: the cooldown is a
    // timestamp comparison, not a scheduled callback.
    const realNow = Date.now;
    try {
      const advanced = realNow() + 5 * 60 * 1000;
      Date.now = () => advanced;
      await store.requestFieldValues(ctx, "environment");
    } finally {
      Date.now = realNow;
    }
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(2);
  });

  it("treats a different field as a different question", async () => {
    const store = await freshStore();
    await store.requestFieldValues(ctx, "environment");
    await store.requestFieldValues(ctx, "service");
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(2);
  });

  it("treats a different stream as a different question", async () => {
    const store = await freshStore();
    await store.requestFieldValues(ctx, "environment");
    await store.requestFieldValues({ ...ctx, streamName: "cache_size_bytes" }, "environment");
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(2);
  });
});

describe("requestFieldValues — refusing to ask", () => {
  it("does not call the endpoint without a complete stream context", async () => {
    const store = await freshStore();
    for (const partial of [
      { ...ctx, org: "" },
      { ...ctx, streamType: "" },
      { ...ctx, streamName: "" },
    ]) {
      await expect(store.requestFieldValues(partial, "environment")).resolves.toEqual([]);
    }
    expect(streamService.fieldValues).not.toHaveBeenCalled();
  });

  it("does not call the endpoint without a field", async () => {
    await expect((await freshStore()).requestFieldValues(ctx, "")).resolves.toEqual([]);
    expect(streamService.fieldValues).not.toHaveBeenCalled();
  });
});

describe("requestFieldValues — when things go wrong", () => {
  it("resolves to an empty list rather than throwing", async () => {
    vi.mocked(streamService.fieldValues).mockRejectedValue(new Error("network"));
    await expect((await freshStore()).requestFieldValues(ctx, "environment")).resolves.toEqual([]);
  });

  it("survives a payload that is not the shape it expects", async () => {
    for (const junk of [{}, { data: {} }, { data: { hits: [] } }, { data: { hits: [{}] } }]) {
      // A fresh copy per shape on purpose here: the negative cache would
      // otherwise suppress every request after the first, and the loop would
      // assert nothing.
      vi.mocked(streamService.fieldValues).mockResolvedValue(junk as any);
      await expect((await freshStore()).requestFieldValues(ctx, "environment")).resolves.toEqual(
        [],
      );
    }
  });

  it("drops empty keys rather than offering a blank row", async () => {
    vi.mocked(streamService.fieldValues).mockResolvedValue(apiResponse(["", "prod"]) as any);
    await expect((await freshStore()).requestFieldValues(ctx, "environment")).resolves.toEqual([
      "prod",
    ]);
  });
});
