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

vi.mock("@/composables/fieldValueDB", () => ({
  mergeValues: vi.fn().mockResolvedValue(undefined),
  mergeMultipleValues: vi.fn().mockResolvedValue(undefined),
  getValues: vi.fn().mockResolvedValue([]),
  evictExpired: vi.fn().mockResolvedValue(0),
  trimToMaxFields: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/stream", () => ({
  default: { fieldValues: vi.fn() },
}));

import streamService from "@/services/stream";
import * as fieldValueDB from "@/composables/fieldValueDB";
import { requestFieldValues, __resetFieldValueRequests } from "./fieldValueStore";

const ctx = { org: "myorg", streamType: "metrics", streamName: "cache_hit_ratio" };

/** The shape the values endpoint actually returns, verified against a live one. */
const apiResponse = (values: string[]) => ({
  data: {
    hits: [{ field: "environment", values: values.map((v, i) => ({ zo_sql_key: v, zo_sql_num: 10 - i })) }],
  },
});

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  vi.clearAllMocks();
  // In-flight and negative-cache state is module-level by design — it must be
  // shared across every editor on the page — so each test starts it clean.
  __resetFieldValueRequests();
  vi.mocked(streamService.fieldValues).mockResolvedValue(apiResponse(["development", "staging"]) as any);
});

describe("requestFieldValues — asking the server", () => {
  it("returns the values it fetched", async () => {
    await expect(requestFieldValues(ctx, "environment")).resolves.toEqual([
      "development",
      "staging",
    ]);
  });

  it("asks for the right stream, field and type", async () => {
    await requestFieldValues(ctx, "environment");
    const [args] = vi.mocked(streamService.fieldValues).mock.calls[0] as any[];
    expect(args.org_identifier).toBe("myorg");
    expect(args.stream_name).toBe("cache_hit_ratio");
    expect(args.fields).toEqual(["environment"]);
    // Without the type a metrics stream is looked up as logs and returns nothing.
    expect(args.type).toBe("metrics");
  });

  it("asks for the last fifteen minutes", async () => {
    await requestFieldValues(ctx, "environment");
    const [args] = vi.mocked(streamService.fieldValues).mock.calls[0] as any[];
    // Microseconds, as this endpoint takes them. Asserted as a WIDTH, because
    // the absolute values depend on when the test runs.
    const widthMinutes = (args.end_time - args.start_time) / 60_000_000;
    expect(widthMinutes).toBeCloseTo(15, 1);
    expect(args.end_time).toBeGreaterThan(args.start_time);
  });

  it("asks for few values, not a page of them", async () => {
    await requestFieldValues(ctx, "environment");
    const [args] = vi.mocked(streamService.fieldValues).mock.calls[0] as any[];
    // A dropdown shows a handful; the endpoint charges for the rest.
    expect(args.size).toBeGreaterThan(0);
    expect(args.size).toBeLessThanOrEqual(50);
  });

  it("writes what it fetched into the cache", async () => {
    // The point of fetching HERE: the next lookup, on any surface and in the
    // next session, is local.
    await requestFieldValues(ctx, "environment");
    await settle();
    expect(fieldValueDB.mergeValues).toHaveBeenCalled();
    const [key, values] = vi.mocked(fieldValueDB.mergeValues).mock.calls[0] as any[];
    expect(key).toBe("myorg|metrics|cache_hit_ratio|environment");
    expect(values).toEqual(expect.arrayContaining(["development", "staging"]));
  });
});

describe("requestFieldValues — not asking twice", () => {
  it("makes ONE request when several editors ask at once", async () => {
    // Every keystroke re-invokes the provider. Without this, a slow endpoint
    // gets a request per character.
    const all = Promise.all([
      requestFieldValues(ctx, "environment"),
      requestFieldValues(ctx, "environment"),
      requestFieldValues(ctx, "environment"),
    ]);
    await all;
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(1);
  });

  it("does not ask again after an empty answer", async () => {
    // A field that genuinely has no values in the window must not be re-queried
    // on every keystroke for the rest of the session.
    vi.mocked(streamService.fieldValues).mockResolvedValue(apiResponse([]) as any);
    await requestFieldValues(ctx, "environment");
    await requestFieldValues(ctx, "environment");
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(1);
  });

  it("does not ask again after a failure", async () => {
    vi.mocked(streamService.fieldValues).mockRejectedValue(new Error("500"));
    await requestFieldValues(ctx, "environment");
    await requestFieldValues(ctx, "environment");
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(1);
  });

  it("treats a different field as a different question", async () => {
    await requestFieldValues(ctx, "environment");
    await requestFieldValues(ctx, "service");
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(2);
  });

  it("treats a different stream as a different question", async () => {
    await requestFieldValues(ctx, "environment");
    await requestFieldValues({ ...ctx, streamName: "cache_size_bytes" }, "environment");
    expect(vi.mocked(streamService.fieldValues).mock.calls.length).toBe(2);
  });
});

describe("requestFieldValues — refusing to ask", () => {
  it("does not call the endpoint without a complete stream context", async () => {
    for (const partial of [
      { ...ctx, org: "" },
      { ...ctx, streamType: "" },
      { ...ctx, streamName: "" },
    ]) {
      await expect(requestFieldValues(partial, "environment")).resolves.toEqual([]);
    }
    expect(streamService.fieldValues).not.toHaveBeenCalled();
  });

  it("does not call the endpoint without a field", async () => {
    await expect(requestFieldValues(ctx, "")).resolves.toEqual([]);
    expect(streamService.fieldValues).not.toHaveBeenCalled();
  });
});

describe("requestFieldValues — when things go wrong", () => {
  it("resolves to an empty list rather than throwing", async () => {
    vi.mocked(streamService.fieldValues).mockRejectedValue(new Error("network"));
    await expect(requestFieldValues(ctx, "environment")).resolves.toEqual([]);
  });

  it("survives a payload that is not the shape it expects", async () => {
    for (const junk of [{}, { data: {} }, { data: { hits: [] } }, { data: { hits: [{}] } }]) {
      __resetFieldValueRequests();
      vi.mocked(streamService.fieldValues).mockResolvedValue(junk as any);
      await expect(requestFieldValues(ctx, "environment")).resolves.toEqual([]);
    }
  });

  it("drops empty keys rather than offering a blank row", async () => {
    __resetFieldValueRequests();
    vi.mocked(streamService.fieldValues).mockResolvedValue(apiResponse(["", "prod"]) as any);
    await expect(requestFieldValues(ctx, "environment")).resolves.toEqual(["prod"]);
  });
});
