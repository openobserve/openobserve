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
  dismissCreditNotice,
  dismissImport,
  isCreditNoticeDismissed,
  isImportDismissed,
  markHintSeen,
  markTabAlive,
  migrateHome,
  pushRecall,
  readHints,
  readHistoryFilter,
  readHome,
  readPlacement,
  readRecall,
  readSidebar,
  recallSelection,
  rememberSelection,
  removeAllSessionKeys,
  resetPrefsForTests,
  watchPrefs,
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
});

describe("prompt recall", () => {
  it("keys recall by user+org under the legacy name", () => {
    pushRecall(KEY, { text: "why 5xx?", chips: [], at: 1 });
    expect(localStorage.getItem(`ai-chat-query-history:${KEY}`)).toContain("why 5xx?");
    expect(readRecall("other")).toEqual([]);
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
    localStorage.setItem(`ai-chat-query-history:${KEY}`, JSON.stringify(other));
    pushRecall(KEY, { text: "mine again", chips: [], at: 3 });
    expect(readRecall(KEY).map((e) => e.text)).toEqual(["mine again", "theirs", "mine"]);
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
  it("remembers hints, credit notices per threshold and the import card per user+org", () => {
    markHintSeen(KEY, "recall");
    expect(readHints(KEY)).toEqual({ recall: true });
    dismissCreditNotice(KEY, 70);
    expect(isCreditNoticeDismissed(KEY, 70)).toBe(true);
    expect(isCreditNoticeDismissed(KEY, 90)).toBe(false);
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
