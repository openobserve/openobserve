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

vi.mock("@/services/stream", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { fieldValues: vi.fn() },
  });
});

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

describe("requestFieldValues — how soon the values are usable", () => {
  it("makes them readable before the background write lands", async () => {
    // The IndexedDB write is scheduled on requestIdleCallback, so persistence
    // arrives whenever the browser is idle. The NEXT KEYSTROKE cannot wait for
    // that: observed in the app, the list still showed field names two and a
    // half seconds after the fetch had returned. The read cache is filled
    // directly so the following lookup is local and immediate, and the write
    // still happens for the next session.
    const store = await freshStore();
    await expect(store.getFieldValuesForSuggestion(ctx, "environment")).resolves.toEqual([]);

    await store.requestFieldValues(ctx, "environment");
    // Deliberately NOT settling: this is the state one keystroke later.
    await expect(store.getFieldValuesForSuggestion(ctx, "environment")).resolves.toEqual([
      "development",
      "staging",
    ]);
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

  it("recovers from a transient failure once the cooldown has passed", async () => {
    // The expiry test above only exercises the EMPTY path. Suppressing failures
    // permanently satisfies it, and leaves a field's values dead for the whole
    // session because one request happened to hit a 500 — the worse half of the
    // same mistake. Asserted through the values, not just the call count: a
    // second request that still returns nothing would be no better.
    vi.mocked(streamService.fieldValues).mockRejectedValueOnce(new Error("500"));
    const store = await freshStore();
    await expect(store.requestFieldValues(ctx, "environment")).resolves.toEqual([]);

    const realNow = Date.now;
    try {
      const advanced = realNow() + 5 * 60 * 1000;
      Date.now = () => advanced;
      await expect(store.requestFieldValues(ctx, "environment")).resolves.toEqual([
        "development",
        "staging",
      ]);
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

describe("requestFieldValues — a request that never answers", () => {
  // services/http.ts has its axios timeout COMMENTED OUT, so nothing upstream
  // ends a stalled request. Without a bound here the in-flight entry is never
  // cleared, every later call joins the same dead promise, and the PromQL path
  // — which awaits this — shows "...Loading" for the rest of the session with
  // no keystroke able to recover it.
  it("gives up rather than hanging its caller", { timeout: 5000 }, async () => {
    vi.mocked(streamService.fieldValues).mockReturnValue(new Promise(() => {}) as any);
    const store = await freshStore();
    vi.useFakeTimers();
    try {
      const pending = store.requestFieldValues(ctx, "environment");
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(pending).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not wedged by it — a later request still goes out", { timeout: 5000 }, async () => {
    vi.mocked(streamService.fieldValues).mockReturnValue(new Promise(() => {}) as any);
    const store = await freshStore();
    vi.useFakeTimers();
    try {
      const pending = store.requestFieldValues(ctx, "environment");
      await vi.advanceTimersByTimeAsync(30_000);
      await pending;

      // Past the cooldown, with the endpoint healthy again.
      vi.mocked(streamService.fieldValues).mockResolvedValue(
        apiResponse(["development", "staging"]) as any,
      );
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      await expect(store.requestFieldValues(ctx, "environment")).resolves.toEqual([
        "development",
        "staging",
      ]);
    } finally {
      vi.useRealTimers();
    }
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

describe("fieldValuesUnavailable — telling a failure from an empty answer", () => {
  it("is false before anything was asked and after an empty answer", async () => {
    const store = await freshStore();
    expect(store.fieldValuesUnavailable(ctx, "region")).toBe(false);
    vi.mocked(streamService.fieldValues).mockResolvedValue(apiResponse([]) as any);
    await store.requestFieldValues(ctx, "region");
    expect(store.fieldValuesUnavailable(ctx, "region")).toBe(false);
  });

  it("is true after a failed request, and stays true through the cooldown", async () => {
    const store = await freshStore();
    vi.mocked(streamService.fieldValues).mockRejectedValue(new Error("500"));
    await store.requestFieldValues(ctx, "region");
    expect(store.fieldValuesUnavailable(ctx, "region")).toBe(true);
    await expect(store.requestFieldValues(ctx, "region")).resolves.toEqual([]);
    expect(store.fieldValuesUnavailable(ctx, "region")).toBe(true);
  });

  it("clears once a later request answers", async () => {
    vi.useFakeTimers();
    try {
      const store = await freshStore();
      vi.mocked(streamService.fieldValues).mockRejectedValueOnce(new Error("500"));
      await store.requestFieldValues(ctx, "region");
      vi.advanceTimersByTime(61_000);
      vi.mocked(streamService.fieldValues).mockResolvedValue(apiResponse(["us-east-1"]) as any);
      await store.requestFieldValues(ctx, "region");
      expect(store.fieldValuesUnavailable(ctx, "region")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the lookback window the editor quotes", async () => {
    const store = await freshStore();
    expect(store.FIELD_VALUES_LOOKBACK_MINUTES).toBe(15);
  });
});

describe("noValueLookup — a lookup that never ran", () => {
  it("is recognisable, so the editor never turns it into 'no values'", async () => {
    const store = await freshStore();
    expect(store.isNoValueLookup(store.noValueLookup())).toBe(true);
    expect(store.isNoValueLookup(new Error("500"))).toBe(false);
  });
});

describe("requestFieldValues — a recent answer is reused", () => {
  // The resolver now asks on every value lookup, even with local values, so each keystroke must not cost a request.
  it("answers a repeat question from the last answer, without a request", async () => {
    const store = await freshStore();
    await store.requestFieldValues(ctx, "environment");
    await expect(store.requestFieldValues(ctx, "environment")).resolves.toEqual([
      "development",
      "staging",
    ]);
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(1);
  });

  it("asks again once the answer is a minute old", async () => {
    const store = await freshStore();
    await store.requestFieldValues(ctx, "environment");
    const realNow = Date.now;
    try {
      const advanced = realNow() + 61_000;
      Date.now = () => advanced;
      await store.requestFieldValues(ctx, "environment");
    } finally {
      Date.now = realNow;
    }
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(2);
  });

  it("forgets the answer when the read cache is cleared on org switch or logout", async () => {
    const store = await freshStore();
    await store.requestFieldValues(ctx, "environment");
    store.clearReadCache();
    await store.requestFieldValues(ctx, "environment");
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(2);
  });
});

describe("requestFieldValues — an explicit time range", () => {
  const timeRange = { startTime: 1_700_000_000_000_000, endTime: 1_700_086_400_000_000 };

  it("asks for exactly that range instead of the last fifteen minutes", async () => {
    await (await freshStore()).requestFieldValues(ctx, "environment", { timeRange });
    const [args] = vi.mocked(streamService.fieldValues).mock.calls[0] as any[];
    expect(args.start_time).toBe(timeRange.startTime);
    expect(args.end_time).toBe(timeRange.endTime);
  });

  it("treats a different range as a different question", async () => {
    const store = await freshStore();
    await store.requestFieldValues(ctx, "environment", { timeRange });
    await store.requestFieldValues(ctx, "environment", {
      timeRange: { ...timeRange, startTime: timeRange.startTime - 1 },
    });
    await store.requestFieldValues(ctx, "environment");
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(3);
  });

  it("reuses the answer for the same range", async () => {
    const store = await freshStore();
    await store.requestFieldValues(ctx, "environment", { timeRange });
    await expect(
      store.requestFieldValues(ctx, "environment", { timeRange: { ...timeRange } }),
    ).resolves.toEqual(["development", "staging"]);
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(1);
  });

  it("never lets a range's values reach the default lookup's cache", async () => {
    const store = await freshStore();
    await store.requestFieldValues(ctx, "tier", { timeRange });
    await settle();
    await expect(store.getFieldValuesForSuggestion(ctx, "tier")).resolves.toEqual([]);
    vi.mocked(streamService.fieldValues).mockResolvedValue(apiResponse(["recent"]) as any);
    await expect(store.requestFieldValues(ctx, "tier")).resolves.toEqual(["recent"]);
  });

  it("keeps an empty or failed answer to its own range", async () => {
    const store = await freshStore();
    vi.mocked(streamService.fieldValues).mockRejectedValueOnce(new Error("500"));
    await store.requestFieldValues(ctx, "environment", { timeRange });
    expect(store.fieldValuesUnavailable(ctx, "environment", timeRange)).toBe(true);
    expect(store.fieldValuesUnavailable(ctx, "environment")).toBe(false);
    await expect(store.requestFieldValues(ctx, "environment")).resolves.toEqual([
      "development",
      "staging",
    ]);
  });
});

describe("requestFieldValues — a typed keyword", () => {
  it("sends the keyword and keeps its answer apart from the unfiltered one", async () => {
    const store = await freshStore();
    await store.requestFieldValues(ctx, "service", { keyword: "open" });
    const [args] = vi.mocked(streamService.fieldValues).mock.calls[0] as any[];
    expect(args.keyword).toBe("open");
    await settle();
    await expect(store.getFieldValuesForSuggestion(ctx, "service")).resolves.toEqual([]);
    await store.requestFieldValues(ctx, "service");
    await store.requestFieldValues(ctx, "service", { keyword: "open" });
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(2);
  });

  it("names the request size, so a caller can tell a full answer from a truncated one", async () => {
    expect((await freshStore()).FIELD_VALUES_REQUEST_SIZE).toBe(10);
  });
});

describe("requestFieldValuesMatching — one keyword request at a time", () => {
  it("asks for the newest prefix once the request in flight returns, and drops the ones between", async () => {
    let finishFirst!: (v: any) => void;
    vi.mocked(streamService.fieldValues)
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)) as any)
      .mockResolvedValue(apiResponse(["openobserve"]) as any);
    const store = await freshStore();
    const first = store.requestFieldValuesMatching(ctx, "service", "o");
    const middle = store.requestFieldValuesMatching(ctx, "service", "op");
    const newest = store.requestFieldValuesMatching(ctx, "service", "ope");
    const truncated = Array.from({ length: 10 }, (_, i) => `o-${i}`);
    finishFirst(apiResponse(truncated));
    await expect(first).resolves.toEqual(truncated);
    await expect(middle).resolves.toEqual([]);
    await expect(newest).resolves.toEqual(["openobserve"]);
    const keywords = vi.mocked(streamService.fieldValues).mock.calls.map((c: any) => c[0].keyword);
    expect(keywords).toEqual(["o", "ope"]);
  });

  it("filters a complete answer for a shorter prefix instead of asking again", async () => {
    vi.mocked(streamService.fieldValues).mockResolvedValue(
      apiResponse(["openobserve", "OpenTelemetry"]) as any,
    );
    const store = await freshStore();
    await store.requestFieldValuesMatching(ctx, "service", "open");
    await expect(store.requestFieldValuesMatching(ctx, "service", "OpenO")).resolves.toEqual([
      "openobserve",
    ]);
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(1);
  });

  it("asks again when the shorter prefix's answer was truncated", async () => {
    const full = Array.from({ length: 10 }, (_, i) => `open-${i}`);
    vi.mocked(streamService.fieldValues).mockResolvedValue(apiResponse(full) as any);
    const store = await freshStore();
    await store.requestFieldValuesMatching(ctx, "service", "open");
    await store.requestFieldValuesMatching(ctx, "service", "openo");
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(2);
  });

  it("asks within the caller's time range", async () => {
    const timeRange = { startTime: 1_000_000, endTime: 2_000_000 };
    const store = await freshStore();
    await store.requestFieldValuesMatching(ctx, "service", "open", { timeRange });
    const [args] = vi.mocked(streamService.fieldValues).mock.calls[0] as any[];
    expect(args).toMatchObject({ start_time: 1_000_000, end_time: 2_000_000, keyword: "open" });
    await store.requestFieldValuesMatching(ctx, "service", "open");
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(2);
  });
});

describe("requestFieldValues — slow lookups over a long range", () => {
  const DAY_US = 86_400_000_000;
  const days = (n: number) => ({
    startTime: 1_000_000_000_000_000,
    endTime: 1_000_000_000_000_000 + n * DAY_US,
  });
  const answerAfter = (ms: number, values: string[]) =>
    vi
      .mocked(streamService.fieldValues)
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(apiResponse(values) as any), ms),
          ) as any,
      );

  it("waits out a seven-day lookup that takes fifteen seconds", async () => {
    vi.useFakeTimers();
    try {
      answerAfter(15_000, ["openobserve"]);
      const store = await freshStore();
      const pending = store.requestFieldValues(ctx, "service", { timeRange: days(7) });
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(pending).resolves.toEqual(["openobserve"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits at most thirty seconds however long the range", async () => {
    vi.useFakeTimers();
    try {
      answerAfter(29_000, ["openobserve"]);
      const store = await freshStore();
      const within = store.requestFieldValues(ctx, "service", { timeRange: days(90) });
      await vi.advanceTimersByTimeAsync(29_000);
      await expect(within).resolves.toEqual(["openobserve"]);

      answerAfter(31_000, ["late"]);
      let answer: string[] | undefined;
      void store
        .requestFieldValues(ctx, "region", { timeRange: days(90) })
        .then((v) => (answer = v));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(answer).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still gives up at ten seconds on the default fifteen-minute lookup", async () => {
    vi.useFakeTimers();
    try {
      answerAfter(12_000, ["development"]);
      const store = await freshStore();
      let answer: string[] | undefined;
      void store.requestFieldValues(ctx, "environment").then((v) => (answer = v));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(answer).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call a timed-out lookup a failure, and keeps its late answer", async () => {
    vi.useFakeTimers();
    try {
      answerAfter(12_000, ["development"]);
      const store = await freshStore();
      await Promise.all([
        store.requestFieldValues(ctx, "environment"),
        vi.advanceTimersByTimeAsync(10_000),
      ]);
      expect(store.fieldValuesUnavailable(ctx, "environment")).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(store.requestFieldValues(ctx, "environment")).resolves.toEqual(["development"]);
      expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pendingFieldValues — a lookup still running after its timeout", () => {
  it("hands back the running request, which settles with the late answer", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(streamService.fieldValues).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(apiResponse(["development"]) as any), 12_000),
          ) as any,
      );
      const store = await freshStore();
      expect(store.pendingFieldValues(ctx, "environment")).toBeNull();
      await Promise.all([
        store.requestFieldValues(ctx, "environment"),
        vi.advanceTimersByTimeAsync(10_000),
      ]);
      const pending = store.pendingFieldValues(ctx, "environment");
      expect(pending).not.toBeNull();
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(pending).resolves.toEqual(["development"]);
      expect(store.pendingFieldValues(ctx, "environment")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a request that never answers, and calls it failed", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(streamService.fieldValues).mockReturnValue(new Promise(() => {}) as any);
      const store = await freshStore();
      await Promise.all([
        store.requestFieldValues(ctx, "environment"),
        vi.advanceTimersByTimeAsync(10_000),
      ]);
      const pending = store.pendingFieldValues(ctx, "environment");
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(pending).resolves.toEqual([]);
      expect(store.fieldValuesUnavailable(ctx, "environment")).toBe(true);
      expect(store.pendingFieldValues(ctx, "environment")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a keyword's and a range's running request to their own key", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(streamService.fieldValues).mockReturnValue(new Promise(() => {}) as any);
      const store = await freshStore();
      const timeRange = { startTime: 1_000_000, endTime: 2_000_000 };
      await Promise.all([
        store.requestFieldValues(ctx, "service", { timeRange, keyword: "open" }),
        vi.advanceTimersByTimeAsync(11_000),
      ]);
      expect(
        store.pendingFieldValues(ctx, "service", { timeRange, keyword: "open" }),
      ).not.toBeNull();
      expect(store.pendingFieldValues(ctx, "service", { timeRange })).toBeNull();
      expect(store.pendingFieldValues(ctx, "service")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("resolvePromqlLabelValues — a label lookup still answering", () => {
  it("waits for the running request instead of reporting no values", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(streamService.fieldValues).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(apiResponse(["development"]) as any), 12_000),
          ) as any,
      );
      await freshStore();
      const { resolvePromqlLabelValues } = await import("./usePromqlSuggestions");
      const answer = resolvePromqlLabelValues("myorg", "cache_hit_ratio", "environment");
      await vi.advanceTimersByTimeAsync(12_000);
      await expect(answer).resolves.toEqual(["development"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("truncation — a blank value still counts toward a full answer", () => {
  const blankThenNine = ["", ...Array.from({ length: 9 }, (_, i) => `a${i}`)];

  it("asks the server for a longer keyword when the shorter one's answer was full", async () => {
    const store = await freshStore();
    vi.mocked(streamService.fieldValues).mockResolvedValueOnce(apiResponse(blankThenNine) as any);
    await store.requestFieldValuesMatching(ctx, "service", "a");
    vi.mocked(streamService.fieldValues).mockResolvedValueOnce(apiResponse(["azebra"]) as any);
    await expect(store.requestFieldValuesMatching(ctx, "service", "aze")).resolves.toEqual([
      "azebra",
    ]);
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(2);
  });

  it("reports the top values as truncated though one of the ten was blank", async () => {
    vi.mocked(streamService.fieldValues).mockReset();
    vi.mocked(streamService.fieldValues).mockResolvedValue(apiResponse(blankThenNine) as any);
    const store = await freshStore();
    const values = await store.requestFieldValues(ctx, "service");
    expect(values).toHaveLength(9);
    expect(store.fieldValuesTruncated(ctx, "service")).toBe(true);
  });
});
