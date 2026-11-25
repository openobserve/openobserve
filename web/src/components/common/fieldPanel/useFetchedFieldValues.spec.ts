// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";
import useFetchedFieldValues, {
  type FieldValuesFetchRequest,
  type FieldValuesPage,
} from "./useFetchedFieldValues";

interface Call {
  request: FieldValuesFetchRequest;
  resolve: (page: FieldValuesPage) => void;
  reject: (error: Error) => void;
}

function setup() {
  const calls: Call[] = [];
  const fetchValues = vi.fn(
    (request: FieldValuesFetchRequest) =>
      new Promise<FieldValuesPage>((resolve, reject) => calls.push({ request, resolve, reject })),
  );
  const values = useFetchedFieldValues(fetchValues, () => 10, ((key: string) => key) as never);
  const state = () => values.fieldValues.value.f;
  const page = (n: number, hasMore = true): FieldValuesPage => ({
    values: Array.from({ length: n }, (_, i) => ({ key: `v${i}`, count: n - i })),
    hasMore,
  });
  return { calls, fetchValues, values, state, page };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useFetchedFieldValues", () => {
  it("loads the first page and settles the generation it started", async () => {
    const { calls, values, state, page } = setup();
    values.open("f");
    expect(calls[0].request).toMatchObject({ field: "f", size: 10, keyword: "" });
    expect(state()).toMatchObject({ isLoading: true, values: [], errMsg: "" });
    expect(state().settled).not.toBe(state().generation);
    calls[0].resolve(page(10));
    await flush();
    expect(state()).toMatchObject({ isLoading: false, hasMore: true });
    expect(state().values).toHaveLength(10);
    expect(state().settled).toBe(state().generation);
  });

  it("keeps the shown values while a bigger page loads, and ignores load more until it settles", async () => {
    const { calls, values, state, page } = setup();
    values.open("f");
    calls[0].resolve(page(10));
    await flush();
    values.loadMore("f");
    values.loadMore("f");
    expect(calls).toHaveLength(2);
    expect(calls[1].request.size).toBe(20);
    expect(state()).toMatchObject({ isLoading: false });
    expect(state().values).toHaveLength(10);
    expect(state().settled).not.toBe(state().generation);
    calls[1].resolve(page(14, false));
    await flush();
    expect(state().values).toHaveLength(14);
    expect(state().hasMore).toBe(false);
  });

  it("keeps the list and the page size when a load more fails, so it can be retried", async () => {
    const { calls, values, state, page } = setup();
    values.open("f");
    calls[0].resolve(page(10));
    await flush();
    values.loadMore("f");
    calls[1].reject(new Error("boom"));
    await flush();
    expect(state()).toMatchObject({ errMsg: "boom", isLoading: false, hasMore: true });
    expect(state().values).toHaveLength(10);
    expect(state().settled).toBe(state().generation);
    values.loadMore("f");
    expect(calls[2].request.size).toBe(20);
  });

  it("shows a failed first page as an error, with a fallback text", async () => {
    const { calls, values, state } = setup();
    values.open("f");
    calls[0].reject(new Error(""));
    await flush();
    expect(state()).toMatchObject({ isLoading: false, errMsg: "search.failedToFetchFieldValues" });
  });

  it("aborts a request a newer one replaced and drops its late answer", async () => {
    const { calls, values, state, page } = setup();
    values.open("f");
    values.refresh("f");
    expect(calls[0].request.signal.aborted).toBe(true);
    calls[1].resolve(page(2));
    calls[0].resolve(page(9));
    await flush();
    expect(state().values).toHaveLength(2);
  });

  it("searches with a keyword from the first page, and puts the earlier list back on clear without a request", async () => {
    const { calls, values, state, page } = setup();
    values.open("f");
    calls[0].resolve(page(10));
    await flush();
    values.loadMore("f");
    calls[1].resolve(page(20));
    await flush();
    values.search("f", "v1");
    expect(calls[2].request).toMatchObject({ keyword: "v1", size: 10 });
    calls[2].resolve(page(1, false));
    await flush();
    values.search("f", "");
    expect(calls).toHaveLength(3);
    expect(state().values).toHaveLength(20);
    expect(state().settled).toBe(state().generation);
    values.loadMore("f");
    expect(calls[3].request).toMatchObject({ keyword: "", size: 30 });
  });

  it("keeps the old values, busy, while a refresh runs, and drops them if it fails (X3)", async () => {
    const { calls, values, state, page } = setup();
    values.open("f");
    calls[0].resolve(page(3));
    await flush();
    values.refresh("f");
    expect(state()).toMatchObject({ isLoading: true });
    expect(state().values).toHaveLength(3);
    calls[1].resolve(page(5));
    await flush();
    expect(state()).toMatchObject({ isLoading: false });
    expect(state().values).toHaveLength(5);
    values.refresh("f");
    calls[2].reject(new Error("gone"));
    await flush();
    expect(state()).toMatchObject({ isLoading: false, errMsg: "gone", values: [] });
  });

  it("aborts and forgets a closed field, and everything on reset", async () => {
    const { calls, values, page } = setup();
    values.open("f");
    values.open("g");
    values.close("f");
    expect(calls[0].request.signal.aborted).toBe(true);
    expect(values.fieldValues.value.f).toBeUndefined();
    values.reset();
    expect(calls[1].request.signal.aborted).toBe(true);
    calls[1].resolve(page(3));
    await flush();
    expect(values.fieldValues.value).toEqual({});
  });
});
