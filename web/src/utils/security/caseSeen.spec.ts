// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_SEEN_CASES,
  caseSeenKey,
  isCaseUnread,
  markCaseSeen,
  readCaseSeen,
  unreadFirst,
} from "./caseSeen";

const ORG = "acme";
const USER = "analyst@acme.io";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("case last-viewed map", () => {
  it("is unread when a detection joined after the analyst last opened the case", () => {
    const row = { id: "c1", status: "acknowledged", last_detection_at: 200 };
    expect(isCaseUnread(row, {})).toBe(true);
    expect(isCaseUnread(row, { c1: 100 })).toBe(true);
    expect(isCaseUnread(row, { c1: 200 })).toBe(false);
    expect(isCaseUnread({ ...row, last_detection_at: null }, {})).toBe(false);
    expect(isCaseUnread({ ...row, status: "resolved" }, {})).toBe(false);
  });

  it("keeps the map per org and analyst, across a reload", () => {
    markCaseSeen(ORG, USER, "c1", 500);
    expect(readCaseSeen(ORG, USER)).toEqual({ c1: 500 });
    expect(readCaseSeen(ORG, "other@acme.io")).toEqual({});
    expect(readCaseSeen("other", USER)).toEqual({});
    expect(localStorage.getItem(caseSeenKey(ORG, USER))).toContain("c1");
  });

  it("keeps the newest views when it is full", () => {
    let seen = {};
    for (let i = 0; i <= MAX_SEEN_CASES; i += 1) seen = markCaseSeen(ORG, USER, `c${i}`, i, seen);
    const stored = readCaseSeen(ORG, USER);
    expect(Object.keys(stored)).toHaveLength(MAX_SEEN_CASES);
    expect(stored.c0).toBeUndefined();
    expect(stored[`c${MAX_SEEN_CASES}`]).toBe(MAX_SEEN_CASES);
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readCaseSeen(ORG, USER)).toEqual({});
    expect(markCaseSeen(ORG, USER, "c1", 1, {})).toEqual({ c1: 1 });
  });

  it("puts unread cases first and keeps the server order otherwise", () => {
    const rows = [
      { id: "a", status: "open" },
      { id: "b", status: "acknowledged", last_detection_at: 10 },
      { id: "c", status: "open" },
    ];
    expect(unreadFirst(rows, {}).map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(unreadFirst(rows, { b: 10 }).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
