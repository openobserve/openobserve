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

import { describe, expect, it } from "vitest";

import { useDbmRequestSeq } from "./useDbmRequestSeq";

/** A promise plus the handle to settle it, so a test can control resolve order. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("useDbmRequestSeq", () => {
  it("accepts the response of the only request in flight", async () => {
    const seq = useDbmRequestSeq();
    const token = seq.begin();
    await Promise.resolve();
    expect(seq.isStale(token)).toBe(false);
  });

  /**
   * The bug this exists for: a slower EARLIER request resolving after a newer
   * one renders pre-filter rows under a toolbar chip that says the filter is
   * applied, with `loading` already false so nothing signals the mismatch.
   */
  it("discards an earlier response that resolves last", async () => {
    const seq = useDbmRequestSeq();
    const first = seq.begin();
    const second = seq.begin();

    const slowFirst = deferred<string>();
    const fastSecond = deferred<string>();

    const rendered: string[] = [];
    const run = async (token: number, source: Promise<string>) => {
      const value = await source;
      if (seq.isStale(token)) return;
      rendered.push(value);
    };

    const a = run(first, slowFirst.promise);
    const b = run(second, fastSecond.promise);

    fastSecond.resolve("filtered");
    await b;
    slowFirst.resolve("unfiltered");
    await a;

    expect(rendered).toEqual(["filtered"]);
  });

  it("keeps every later token stale once a newer one is issued", () => {
    const seq = useDbmRequestSeq();
    const first = seq.begin();
    const second = seq.begin();
    const third = seq.begin();
    expect(seq.isStale(first)).toBe(true);
    expect(seq.isStale(second)).toBe(true);
    expect(seq.isStale(third)).toBe(false);
  });

  /**
   * A page owns one token, so a secondary fetch started by the same load must
   * be discarded by the same increment — that is what stops a breakdown or a
   * caller list repopulating under a newly-picked window.
   */
  it("invalidates work started before the current load, whoever started it", () => {
    const seq = useDbmRequestSeq();
    const child = seq.begin();
    seq.begin();
    expect(seq.isStale(child)).toBe(true);
  });

  it("hands out a distinct token per call", () => {
    const seq = useDbmRequestSeq();
    expect(seq.begin()).not.toBe(seq.begin());
  });

  /**
   * A secondary fetch has to JOIN the load that owns the page, not claim it —
   * claiming would have a child request invalidate its own parent.
   */
  describe("current — joining the load in progress", () => {
    it("reads the owning token without claiming the page", () => {
      const seq = useDbmRequestSeq();
      const parent = seq.begin();
      expect(seq.current()).toBe(parent);
      expect(seq.isStale(parent)).toBe(false);
    });

    it("goes stale with its parent when the next load starts", () => {
      const seq = useDbmRequestSeq();
      seq.begin();
      const child = seq.current();
      seq.begin();
      expect(seq.isStale(child)).toBe(true);
    });
  });
});
