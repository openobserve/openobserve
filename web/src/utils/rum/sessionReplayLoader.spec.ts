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
import {
  appendableIndexes,
  createActivityTimer,
  createLoaderState,
  createQueryError,
  failBatch,
  isFetchable,
  isRetryableError,
  isSettled,
  markInFlight,
  markSkipped,
  markStored,
  networkSkippedIndexes,
  requeueNetworkSkips,
  settleBatch,
  withRetries,
} from "./sessionReplayLoader";

const noWait = () => Promise.resolve();

describe("settleBatch", () => {
  it("re-queues a segment a successful batch did not return, at most twice", () => {
    const state = createLoaderState(1);
    for (let attempt = 1; attempt <= 2; attempt++) {
      markInFlight(state, [0]);
      settleBatch(state, [0]);
      expect(state.status[0]).toBe("fetchedMissing");
      expect(isFetchable(state, 0)).toBe(true);
    }
    markInFlight(state, [0]);
    settleBatch(state, [0]);
    expect(state.status[0]).toBe("skipped");
    expect(state.skipReason[0]).toBe("missing");
    expect(isFetchable(state, 0)).toBe(false);
  });

  it("leaves segments that were stored alone", () => {
    const state = createLoaderState(2);
    markInFlight(state, [0, 1]);
    markStored(state, 0);
    settleBatch(state, [0, 1]);
    expect(state.status).toEqual(["stored", "fetchedMissing"]);
  });
});

describe("failBatch and requeueNetworkSkips", () => {
  it("skips a batch that ran out of attempts and re-queues only network failures", () => {
    const state = createLoaderState(4);
    markInFlight(state, [0, 1]);
    failBatch(state, [0, 1]);
    markSkipped(state, 2, "parse");
    markStored(state, 3);
    expect(networkSkippedIndexes(state)).toEqual([0, 1]);
    expect(isSettled(state)).toBe(true);

    expect(requeueNetworkSkips(state)).toEqual([0, 1]);
    expect(state.status).toEqual(["missing", "missing", "skipped", "stored"]);
    expect(isSettled(state)).toBe(false);
  });
});

describe("appendableIndexes", () => {
  it("hands over segments in order until the first one still outstanding", () => {
    const state = createLoaderState(5);
    markStored(state, 1);
    markSkipped(state, 2, "network");
    markStored(state, 4);
    expect(appendableIndexes(state, 0)).toEqual([1, 2]);
  });

  it("holds a later segment back until the earlier one arrives", () => {
    const state = createLoaderState(3);
    markStored(state, 2);
    expect(appendableIndexes(state, 0)).toEqual([]);
    markStored(state, 1);
    expect(appendableIndexes(state, 0)).toEqual([1, 2]);
  });
});

describe("isRetryableError", () => {
  it.each([
    ["a network failure with no status", new Error("Failed to fetch"), true],
    ["a 500", createQueryError("x", 500), true],
    ["a 503 from axios", { response: { status: 503 } }, true],
    ["a 429", createQueryError("x", 429), true],
    ["a timeout", createQueryError("x", undefined, "timeout"), true],
    ["a 401 after a token refresh", createQueryError("x", 401), true],
    ["a 400", createQueryError("x", 400), false],
    ["a 403", createQueryError("x", 403), false],
    ["a 404", { response: { status: 404 } }, false],
    ["an in-stream invalid-SQL code", createQueryError("x", undefined, "20001"), false],
    ["an in-stream field-not-found code", createQueryError("x", undefined, "20004"), false],
    ["an in-stream search timeout code", createQueryError("x", undefined, "20010"), true],
    ["an in-stream rate-limit code", createQueryError("x", undefined, "20012"), true],
    ["an in-stream internal error code", createQueryError("x", undefined, "10001"), true],
  ])("classifies %s", (_label, error, expected) => {
    expect(isRetryableError(error)).toBe(expected);
  });
});

describe("withRetries", () => {
  it("makes three attempts for a retryable error, waiting 1 s then 2 s", async () => {
    const fn = vi.fn().mockRejectedValue(createQueryError("x", 502));
    const wait = vi.fn(noWait);
    const onRetry = vi.fn();
    await expect(withRetries(fn, { isCancelled: () => false, wait, onRetry })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
    expect(onRetry.mock.calls.map((c) => c[0])).toEqual([2, 3]);
  });

  it("makes one attempt for an error that cannot succeed next time", async () => {
    const fn = vi.fn().mockRejectedValue(createQueryError("x", 400));
    await expect(withRetries(fn, { isCancelled: () => false, wait: noWait })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns the first success", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(createQueryError("x", 500))
      .mockResolvedValueOnce("ok");
    await expect(withRetries(fn, { isCancelled: () => false, wait: noWait })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("stops retrying once the caller is cancelled during a wait", async () => {
    const fn = vi.fn().mockRejectedValue(createQueryError("x", 500));
    await expect(withRetries(fn, { isCancelled: () => true, wait: noWait })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("createActivityTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires when no first byte arrives within 90 s", () => {
    const onTimeout = vi.fn();
    createActivityTimer(onTimeout);
    vi.advanceTimersByTime(89_999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("fires after 30 s of silence once the stream has started", () => {
    const onTimeout = vi.fn();
    const timer = createActivityTimer(onTimeout);
    vi.advanceTimersByTime(5_000);
    timer.touch();
    vi.advanceTimersByTime(29_999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("never fires on a request that keeps sending, however long it runs", () => {
    const onTimeout = vi.fn();
    const timer = createActivityTimer(onTimeout);
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(20_000);
      timer.touch();
    }
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("stops once the request settles", () => {
    const onTimeout = vi.fn();
    const timer = createActivityTimer(onTimeout);
    timer.clear();
    timer.touch();
    vi.advanceTimersByTime(200_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
