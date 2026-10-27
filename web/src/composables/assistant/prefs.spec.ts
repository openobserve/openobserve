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

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContextChip } from "./context/types";
import {
  RECALL_CAP,
  TAB_HEARTBEAT_MS,
  TAB_STALE_MS,
  dismissImport,
  isImportDismissed,
  markHintSeen,
  markTabAlive,
  migrateHome,
  markedUserOrgKeys,
  pushRecall,
  readAnnotations,
  readHints,
  readHistoryFilter,
  readHome,
  readPlacement,
  readRecall,
  readSidebar,
  recallSelection,
  rememberSelection,
  removeAllSessionKeys,
  removeAnnotations,
  removeRecall,
  resetPrefsForTests,
  watchPrefs,
  writeAnnotation,
  writeHistoryFilter,
  writePlacement,
  writeSidebar,
} from "./prefs";

const KEY = "uok-1";

const chip = (id: string): ContextChip => ({
  id,
  kind: "stream",
  label: "default" as ContextChip["label"],
  sizeBytes: 10,
  provenance: "page",
  sent: "whitelist",
  ref: { type: "stream", id, org: "default" },
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetPrefsForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("prompt recall", () => {
  it("keys recall by user+org on its own key, never writing objects where the legacy reader reads strings", () => {
    pushRecall(KEY, { text: "why 5xx?", chips: [], at: 1 });
    expect(localStorage.getItem(`o2.assistant.recall:${KEY}`)).toContain("why 5xx?");
    expect(localStorage.getItem(`ai-chat-query-history:${KEY}`)).toBeNull();
    expect(readRecall("other")).toEqual([]);
  });

  it("reads the legacy string list as chipless entries and copies it once on the first push", () => {
    localStorage.setItem(`ai-chat-query-history:${KEY}`, '["why 5xx"]');
    expect(readRecall(KEY)).toEqual([{ text: "why 5xx", chips: [], at: 0 }]);
    expect(() => pushRecall(KEY, { text: "and 4xx?", chips: [chip("a")], at: 5 })).not.toThrow();
    expect(readRecall(KEY).map((e) => e.text)).toEqual(["and 4xx?", "why 5xx"]);
    expect(localStorage.getItem(`ai-chat-query-history:${KEY}`)).toBe('["why 5xx"]');
    localStorage.setItem(`ai-chat-query-history:${KEY}`, '["later legacy prompt"]');
    expect(readRecall(KEY).map((e) => e.text)).toEqual(["and 4xx?", "why 5xx"]);
  });

  it("drops malformed entries instead of throwing", () => {
    localStorage.setItem(
      `o2.assistant.recall:${KEY}`,
      JSON.stringify([
        null,
        7,
        "",
        "bare string",
        { text: 3 },
        { text: "no chips" },
        { text: "bad chips", chips: [null, { id: "x" }, chip("ok")], at: "soon" },
      ]),
    );
    expect(readRecall(KEY)).toEqual([
      { text: "bare string", chips: [], at: 0 },
      { text: "no chips", chips: [], at: 0 },
      { text: "bad chips", chips: [chip("ok")], at: 0 },
    ]);
    expect(() => pushRecall(KEY, { text: "next", chips: [], at: 1 })).not.toThrow();
  });

  it("removes both the v2 and the legacy key", () => {
    pushRecall(KEY, { text: "secret", chips: [], at: 1 });
    localStorage.setItem(`ai-chat-query-history:${KEY}`, '["secret"]');
    removeRecall(KEY);
    expect(localStorage.length).toBe(0);
    expect(readRecall(KEY)).toEqual([]);
  });

  it("dedupes by text and chip refs, prepends and caps at ten", () => {
    for (let i = 0; i < RECALL_CAP + 3; i += 1)
      pushRecall(KEY, { text: `p${i}`, chips: [], at: i });
    pushRecall(KEY, { text: "p5", chips: [], at: 99 });
    const entries = readRecall(KEY);
    expect(entries).toHaveLength(RECALL_CAP);
    expect(entries[0]).toMatchObject({ text: "p5", at: 99 });
    expect(entries.filter((e) => e.text === "p5")).toHaveLength(1);
    pushRecall(KEY, { text: "p5", chips: [chip("a")], at: 100 });
    expect(readRecall(KEY).filter((e) => e.text === "p5")).toHaveLength(2);
  });

  it("merges with what another tab wrote since this tab last read", () => {
    pushRecall(KEY, { text: "mine", chips: [], at: 1 });
    // The second tab writes straight to the shared localStorage.
    const other = [{ text: "theirs", chips: [], at: 2 }, ...readRecall(KEY)];
    localStorage.setItem(`o2.assistant.recall:${KEY}`, JSON.stringify(other));
    pushRecall(KEY, { text: "mine again", chips: [], at: 3 });
    expect(readRecall(KEY).map((e) => e.text)).toEqual(["mine again", "theirs", "mine"]);
  });
});

describe("annotations", () => {
  afterEach(() => localStorage.clear());

  it("keeps votes, Opened times and asked windows per chat, and drops run rows", () => {
    writeAnnotation(
      "k1",
      "s1",
      "turn:t1:feedback",
      { feedback: { rating: "down", reason: "wrong_query" } },
      1,
    );
    writeAnnotation("k1", "s1", "b1", { linkOutcome: { openedAt: 5 } }, 2);
    writeAnnotation("k1", "s1", "b2", { run: { status: "done", rows: 4 } } as never, 3);
    writeAnnotation("k1", "s2", "turn:t9:window", { window: { from: 1, to: 2 } }, 4);
    expect(readAnnotations("k1", "s1")).toEqual({
      "turn:t1:feedback": { feedback: { rating: "down", reason: "wrong_query" } },
      b1: { linkOutcome: { openedAt: 5 } },
    });
    expect(readAnnotations("k1", "s2")).toEqual({
      "turn:t9:window": { window: { from: 1, to: 2 } },
    });
    expect(readAnnotations("k2", "s1")).toEqual({});
  });

  it("validates what it reads back and forgets everything on sign-out", () => {
    localStorage.setItem(
      "o2.assistant.annotations:k1",
      JSON.stringify({
        s1: {
          at: 1,
          entries: {
            a: { feedback: { rating: "maybe" } },
            b: { linkOutcome: { openedAt: "soon" } },
            c: { window: { from: 9, to: 1 } },
            d: { feedback: { rating: "up", reason: "x".repeat(200) } },
          },
        },
      }),
    );
    expect(readAnnotations("k1", "s1")).toEqual({ d: { feedback: { rating: "up" } } });
    localStorage.setItem("o2.assistant.annotations:k1", "{not json");
    expect(readAnnotations("k1", "s1")).toEqual({});
    writeAnnotation("k1", "s1", "b1", { linkOutcome: { openedAt: 5 } }, 1);
    removeAnnotations("k1");
    expect(readAnnotations("k1", "s1")).toEqual({});
  });

  it("keeps an approval's record and its ledger entries across a reload, an undo still on its way as unconfirmed", () => {
    const entry = {
      id: "led-1",
      approvalId: "t1:1",
      turnId: "t1",
      tool: "o2_delete",
      op: "delete" as const,
      resource: { type: "alert", name: "a", id: "A1" },
      status: "done" as const,
      undoable: true,
      undoing: true,
      at: 3,
    };
    writeAnnotation(
      "k1",
      "s1",
      "approval:t1:1",
      {
        approvalOutcome: { state: "done", at: 3, decision: { approved: true, scope: "once" } },
        approvalResult: {
          status: "done",
          items: [{ type: "alert", name: "a", status: "done", undoable: true, ledgerId: "led-1" }],
          resolvedBy: "me@example.com",
          resolvedAt: 3,
        },
        ledger: [entry],
      },
      3,
    );
    writeAnnotation(
      "k1",
      "s1",
      "approval:t1:2",
      { approvalOutcome: { state: "sending", at: 4 } },
      4,
    );
    const back = readAnnotations("k1", "s1");
    expect(back["approval:t1:1"].approvalOutcome).toEqual({
      state: "done",
      at: 3,
      decision: { approved: true, scope: "once" },
    });
    expect(back["approval:t1:1"].approvalResult?.items[0]).toMatchObject({ ledgerId: "led-1" });
    const { undoing: _undoing, ...kept } = entry;
    expect(back["approval:t1:1"].ledger).toEqual([{ ...kept, undoUnconfirmed: true }]);
    expect(back["approval:t1:2"].approvalOutcome?.state).toBe("unconfirmed");
  });

  it("drops an approval record it cannot trust", () => {
    localStorage.setItem(
      "o2.assistant.annotations:k1",
      JSON.stringify({
        s1: {
          at: 1,
          entries: {
            a: { approvalOutcome: { state: "approved_by_magic", at: 1 } },
            b: { approvalResult: { status: "done", items: "all", resolvedAt: "now" } },
            c: { ledger: [{ id: 1, op: "drop_table" }] },
          },
        },
      }),
    );
    expect(readAnnotations("k1", "s1")).toEqual({});
  });

  it("caps a chat at 200 keys on write, keeping the newest and the one just written", () => {
    for (let i = 0; i < 205; i++)
      writeAnnotation("k1", "s1", `b${i}`, { linkOutcome: { openedAt: i + 1 } }, i);
    writeAnnotation("k1", "s1", "b10", { feedback: { rating: "up", reason: "too_slow" } }, 300);
    const stored = JSON.parse(localStorage.getItem("o2.assistant.annotations:k1")!);
    expect(Object.keys(stored.s1.entries)).toHaveLength(200);
    const read = readAnnotations("k1", "s1");
    expect(read.b204).toEqual({ linkOutcome: { openedAt: 205 } });
    expect(read.b10).toEqual({ feedback: { rating: "up", reason: "too_slow" } });
    expect(read.b4).toBeUndefined();
  });

  it("keeps only a known vote reason", () => {
    writeAnnotation("k1", "s1", "v", { feedback: { rating: "down", reason: "<img src=x>" } }, 1);
    expect(readAnnotations("k1", "s1").v).toEqual({ feedback: { rating: "down" } });
  });

  it("keeps the newest 50 chats", () => {
    for (let i = 0; i < 55; i++)
      writeAnnotation("k1", `s${i}`, "b", { linkOutcome: { openedAt: i + 1 } }, i);
    expect(readAnnotations("k1", "s0")).toEqual({});
    expect(readAnnotations("k1", "s54")).toEqual({ b: { linkOutcome: { openedAt: 55 } } });
  });
});

describe("sidebar prefs", () => {
  it("writes width and mode by read-merge-write, keeping another tab's field", () => {
    writeSidebar(KEY, { widthRem: 26 });
    localStorage.setItem(
      `o2.assistant.sidebar:${KEY}`,
      JSON.stringify({ widthRem: 26, mode: "floating" }),
    );
    writeSidebar(KEY, { widthRem: 30 });
    expect(readSidebar(KEY)).toEqual({ widthRem: 30, mode: "floating" });
  });

  it("degrades to defaults when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeSidebar(KEY, { mode: "pinned" })).not.toThrow();
    expect(readSidebar(KEY)).toEqual({});
    expect(readRecall(KEY)).toEqual([]);
    expect(recallSelection(KEY)).toBeNull();
  });
});

describe("home prefs", () => {
  it("migrates the unscoped tab state once and maps a saved ai tab to overview", () => {
    localStorage.setItem("o2_home_tab_order", JSON.stringify(["ai", "overview", "usage"]));
    localStorage.setItem("o2_home_active_tab", "ai");
    expect(migrateHome(KEY)).toEqual({
      order: ["overview", "usage"],
      active: "overview",
      migratedFromUnscoped: true,
    });
    localStorage.setItem("o2_home_active_tab", "usage");
    expect(migrateHome(KEY).active).toBe("overview");
    expect(localStorage.getItem("o2_home_tab_order")).not.toBeNull();
    expect(readHome("other")).toEqual({});
  });
});

describe("one-time notices", () => {
  it("remembers hints and the import card per user+org", () => {
    markHintSeen(KEY, "recall");
    expect(readHints(KEY)).toEqual({ recall: true });
    dismissImport(KEY);
    expect(isImportDismissed(KEY)).toBe(true);
    expect(isImportDismissed("other")).toBe(false);
  });
});

describe("per-tab session keys", () => {
  it("restores the selection once per user+org per page load", () => {
    rememberSelection(KEY, "sid-1");
    expect(recallSelection(KEY)).toBe("sid-1");
    expect(recallSelection(KEY)).toBeNull();
    rememberSelection("other", "sid-2");
    expect(recallSelection("other")).toBe("sid-2");
    rememberSelection(KEY, null);
    expect(sessionStorage.getItem(`o2.assistant.selected:${KEY}`)).toBeNull();
  });

  it("stores placement and the history filter in sessionStorage", () => {
    writePlacement(KEY, {
      placement: { kind: "sidebar", mode: "floating" },
      previousPlacement: null,
    });
    writeHistoryFilter(KEY, { kind: "pinned", q: "" });
    expect(readPlacement(KEY)?.placement).toEqual({ kind: "sidebar", mode: "floating" });
    expect(readHistoryFilter(KEY)).toEqual({ kind: "pinned", q: "" });
    expect(localStorage.length).toBe(0);
  });

  it("removes every o2.assistant.* session key of the user+org on sign-out, drafts included", () => {
    rememberSelection(KEY, "sid-1");
    writeHistoryFilter(KEY, { kind: "all", q: "" });
    sessionStorage.setItem(`o2.assistant.draft:${KEY}:sid-1`, "{}");
    sessionStorage.setItem(`o2.assistant.draft:other:sid-1`, "{}");
    sessionStorage.setItem("unrelated", "1");
    removeAllSessionKeys(KEY);
    expect(Object.keys(sessionStorage).sort()).toEqual([
      "o2.assistant.draft:other:sid-1",
      "unrelated",
    ]);
  });

  it("tells a duplicated tab from a reload", () => {
    expect(markTabAlive(KEY).duplicated).toBe(false);
    expect(markTabAlive(KEY).duplicated).toBe(false);
    // A duplicate is a new page load over a copy of a live tab's sessionStorage.
    resetPrefsForTests();
    expect(markTabAlive(KEY).duplicated).toBe(true);
    window.dispatchEvent(new Event("pagehide"));
    resetPrefsForTests();
    expect(markTabAlive(KEY).duplicated).toBe(false);
  });

  it("reads a marker a crash or discard left behind as a reload once it is stale", () => {
    vi.useFakeTimers();
    expect(markTabAlive(KEY).duplicated).toBe(false);
    // The tab dies without pagehide; the next load finds its marker still live but no longer beating.
    resetPrefsForTests();
    vi.advanceTimersByTime(TAB_STALE_MS);
    expect(markTabAlive(KEY).duplicated).toBe(false);
  });

  it("keeps a live tab's marker fresh, so a duplicate taken any time later is caught", () => {
    vi.useFakeTimers();
    expect(markTabAlive(KEY).duplicated).toBe(false);
    vi.advanceTimersByTime(TAB_STALE_MS * 4);
    const marker = JSON.parse(sessionStorage.getItem(`o2.assistant.tab:${KEY}`)!);
    expect(Date.now() - marker.at).toBeLessThan(TAB_HEARTBEAT_MS + 1);
    resetPrefsForTests();
    expect(markTabAlive(KEY).duplicated).toBe(true);
  });

  it("lists every user+org this page load marked", () => {
    markTabAlive("org-a");
    markTabAlive("org-b");
    expect(markedUserOrgKeys()).toEqual(["org-a", "org-b"]);
  });

  it("never reads an earlier org of the same tab as a duplicate, across a reload too", () => {
    expect(markTabAlive("org-a").duplicated).toBe(false);
    expect(markTabAlive("org-b").duplicated).toBe(false);
    expect(markTabAlive("org-a").duplicated).toBe(false);
    window.dispatchEvent(new Event("pagehide"));
    resetPrefsForTests();
    expect(markTabAlive("org-b").duplicated).toBe(false);
    expect(markTabAlive("org-a").duplicated).toBe(false);
  });
});

describe("storage events", () => {
  it("names the pref another tab changed and ignores other keys", () => {
    const changed = vi.fn();
    const stop = watchPrefs(KEY, changed);
    window.dispatchEvent(new StorageEvent("storage", { key: `o2.assistant.sidebar:${KEY}` }));
    window.dispatchEvent(new StorageEvent("storage", { key: `ai-chat-query-history:${KEY}` }));
    window.dispatchEvent(
      new StorageEvent("storage", { key: `o2.assistant.creditNotice:${KEY}:90` }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "o2.assistant.sidebar:other" }));
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(changed.mock.calls.map(([name]) => name)).toEqual(["sidebar", "recall", "creditNotice"]);
    stop();
    window.dispatchEvent(new StorageEvent("storage", { key: `o2.assistant.home:${KEY}` }));
    expect(changed).toHaveBeenCalledTimes(3);
  });
});
