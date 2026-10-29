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

import { DRAFT_DEBOUNCE_MS, createDraftStore, draftKey, type DraftPayload } from "./drafts";

const KEY = "uok-1";

const draft = (text: string): DraftPayload => ({
  text,
  chips: [],
  timeOverride: { from: 1, to: 2 },
  removedPageKeys: ["time"],
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

describe("drafts", () => {
  it("writes per user+org and chat after a 250 ms debounce", () => {
    const drafts = createDraftStore();
    drafts.schedule(KEY, "sid-1", draft("hel"));
    drafts.schedule(KEY, "sid-1", draft("hello"));
    vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 1);
    expect(sessionStorage.getItem(draftKey(KEY, "sid-1"))).toBeNull();
    vi.advanceTimersByTime(1);
    expect(JSON.parse(sessionStorage.getItem(`o2.assistant.draft:${KEY}:sid-1`)!)).toEqual(
      draft("hello"),
    );
  });

  it("reads the pending draft before the debounce fires, and flushes on demand", () => {
    const drafts = createDraftStore();
    drafts.schedule(KEY, "sid-1", draft("typing"));
    expect(drafts.read(KEY, "sid-1")?.text).toBe("typing");
    drafts.flush();
    expect(sessionStorage.getItem(draftKey(KEY, "sid-1"))).toContain("typing");
  });

  it("never persists images", () => {
    const drafts = createDraftStore();
    const withImage = { ...draft("look"), images: [{ filename: "a.png" }] } as DraftPayload;
    drafts.schedule(KEY, "sid-1", withImage);
    drafts.flush();
    expect(sessionStorage.getItem(draftKey(KEY, "sid-1"))).not.toContain("a.png");
  });

  it("removes the key for an empty draft and on remove", () => {
    const drafts = createDraftStore();
    drafts.schedule(KEY, "sid-1", draft("x"));
    drafts.flush();
    drafts.schedule(KEY, "sid-1", { text: "", chips: [], timeOverride: null, removedPageKeys: [] });
    drafts.flush();
    expect(sessionStorage.getItem(draftKey(KEY, "sid-1"))).toBeNull();
    drafts.schedule(KEY, "sid-2", draft("y"));
    drafts.remove(KEY, "sid-2");
    vi.runAllTimers();
    expect(drafts.read(KEY, "sid-2")).toBeNull();
  });

  it("falls back to memory and flags the composer when storage is blocked", () => {
    const drafts = createDraftStore({
      storage: () => {
        throw new Error("SecurityError");
      },
    });
    drafts.schedule(KEY, "sid-1", draft("private"));
    drafts.flush();
    expect(drafts.storageBlocked.value).toBe(true);
    expect(drafts.read(KEY, "sid-1")?.text).toBe("private");
  });

  it("clears every draft of one user+org on sign-out and keeps another's", () => {
    const drafts = createDraftStore();
    drafts.schedule(KEY, "sid-1", draft("a"));
    drafts.schedule(KEY, "sid-2", draft("b"));
    drafts.schedule("other", "sid-3", draft("c"));
    drafts.flush();
    drafts.schedule(KEY, "sid-4", draft("pending"));
    drafts.clearAllForUser(KEY);
    vi.runAllTimers();
    expect(Object.keys(sessionStorage)).toEqual([draftKey("other", "sid-3")]);
    expect(drafts.read(KEY, "sid-4")).toBeNull();
  });

  it("keeps two tabs' drafts apart because sessionStorage is per tab", () => {
    const tabA = new Map<string, string>();
    const fake = (map: Map<string, string>) =>
      ({
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        key: (i: number) => [...map.keys()][i] ?? null,
        get length() {
          return map.size;
        },
      }) as unknown as Storage;
    const a = createDraftStore({ storage: () => fake(tabA) });
    const b = createDraftStore({ storage: () => fake(new Map()) });
    a.schedule(KEY, "sid-1", draft("only in A"));
    a.flush();
    expect(b.read(KEY, "sid-1")).toBeNull();
    expect(a.read(KEY, "sid-1")?.text).toBe("only in A");
  });

  it("reads the newer draft from memory when a later write hits the quota", () => {
    const map = new Map<string, string>();
    let full = false;
    const store = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (full) throw new Error("QuotaExceededError");
        map.set(k, v);
      },
      removeItem: (k: string) => void map.delete(k),
    } as unknown as Storage;
    const drafts = createDraftStore({ storage: () => store });
    drafts.schedule(KEY, "sid-1", draft("older"));
    drafts.flush();
    full = true;
    drafts.schedule(KEY, "sid-1", draft("newer"));
    drafts.flush();
    expect(drafts.read(KEY, "sid-1")?.text).toBe("newer");
  });
});
