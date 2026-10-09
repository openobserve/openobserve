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
import { computed } from "vue";
import {
  PANEL_DRAFT_MAX_AGE_MS,
  PANEL_DRAFT_MAX_COUNT,
  getTabId,
  panelDraftKey,
  requestDraftRestore,
  takeDraftRestore,
  usePanelDraft,
  type PanelDraft,
} from "./usePanelDraft";

const PREFIX = "o2.dashboards.panelDraft.";
const content = (title: string) => ({
  panel: { title },
  baseVersion: "h1",
  variables: { "var-env": "prod" },
});
const stored = (key: string): PanelDraft | null => {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
};
const draftKeys = () =>
  Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) && !k.endsWith(".probe"));

describe("usePanelDraft", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("keys", () => {
    // Each tab is its own module instance; jsdom's one sessionStorage stands in for the copy a duplicated tab receives.
    const openTab = async () => {
      vi.resetModules();
      return import("./usePanelDraft");
    };

    it("uses the panel id, or new:<tabId> for a new panel, stable within the tab", () => {
      expect(panelDraftKey("acme", "d1", "p1")).toBe(`${PREFIX}acme.d1.p1`);
      const tabId = getTabId();
      expect(panelDraftKey("acme", "d1")).toBe(`${PREFIX}acme.d1.new:${tabId}`);
      expect(getTabId()).toBe(tabId);
    });

    it("gives a duplicated tab, which copies sessionStorage, its own key, so the two never overwrite each other", async () => {
      const tabA = await openTab();
      const keyA = tabA.panelDraftKey("acme", "d1");
      const tabB = await openTab();
      const keyB = tabB.panelDraftKey("acme", "d1");
      expect(keyA).not.toBe(keyB);

      const a = tabA.usePanelDraft(computed(() => keyA));
      const b = tabB.usePanelDraft(computed(() => keyB));
      a.save(() => content("from A"));
      b.save(() => content("from B"));
      vi.advanceTimersByTime(1000);

      expect(stored(keyA)?.panel.title).toBe("from A");
      expect(stored(keyB)?.panel.title).toBe("from B");
    });

    it("keeps the id across a reload and leaves nothing in sessionStorage for a later duplicate", async () => {
      const before = await openTab();
      const id = before.getTabId();
      window.dispatchEvent(new Event("pagehide"));
      const reloaded = await openTab();
      expect(reloaded.getTabId()).toBe(id);
      expect(sessionStorage.getItem(`${PREFIX}tabId`)).toBeNull();
      const duplicate = await openTab();
      expect(duplicate.getTabId()).not.toBe(id);
    });

    it("claims the reload stash when the module loads, so a tab duplicated after a reload on another page gets its own id", async () => {
      const drafting = await openTab();
      const id = drafting.getTabId();
      window.dispatchEvent(new Event("pagehide"));
      const reloadedElsewhere = await openTab();
      const original = { ...sessionStorage };
      const duplicate = await openTab();
      const duplicateId = duplicate.getTabId();
      sessionStorage.clear();
      for (const [k, v] of Object.entries(original)) sessionStorage.setItem(k, v);
      expect(reloadedElsewhere.getTabId()).toBe(id);
      expect(duplicateId).not.toBe(id);
    });

    it("does not reuse an id stashed longer ago than a reload takes", async () => {
      const before = await openTab();
      const id = before.getTabId();
      window.dispatchEvent(new Event("pagehide"));
      vi.advanceTimersByTime(61_000);
      const later = await openTab();
      expect(later.getTabId()).not.toBe(id);
    });

    it("takes the id back out of sessionStorage when the page returns from the back-forward cache", async () => {
      const tab = await openTab();
      tab.getTabId();
      window.dispatchEvent(new Event("pagehide"));
      expect(sessionStorage.getItem(`${PREFIX}tabId`)).not.toBeNull();
      window.dispatchEvent(new Event("pageshow"));
      expect(sessionStorage.getItem(`${PREFIX}tabId`)).toBeNull();
    });
  });

  describe("save", () => {
    it("writes the panel, base version, session variables and a timestamp 1 s after the last change", () => {
      const key = `${PREFIX}acme.d1.p1`;
      const draft = usePanelDraft(computed(() => key));
      const produce = vi.fn(() => content("third"));

      draft.save(() => content("first"));
      vi.advanceTimersByTime(600);
      draft.save(() => content("second"));
      vi.advanceTimersByTime(600);
      draft.save(produce);
      vi.advanceTimersByTime(999);
      expect(stored(key)).toBeNull();
      expect(produce).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(produce).toHaveBeenCalledTimes(1);
      expect(stored(key)).toEqual({
        panel: { title: "third" },
        baseVersion: "h1",
        variables: { "var-env": "prod" },
        savedAt: Date.now(),
      });
    });

    it("removes the draft when the content says there is nothing to keep", () => {
      const key = `${PREFIX}acme.d1.p1`;
      const draft = usePanelDraft(computed(() => key));
      draft.save(() => content("edit"));
      vi.advanceTimersByTime(1000);
      draft.save(() => null);
      vi.advanceTimersByTime(1000);
      expect(stored(key)).toBeNull();
    });

    it("flush writes a pending save at once and cancel drops it", () => {
      const key = `${PREFIX}acme.d1.p1`;
      const draft = usePanelDraft(computed(() => key));
      draft.save(() => content("now"));
      draft.flush();
      expect(stored(key)?.panel.title).toBe("now");

      draft.save(() => content("dropped"));
      draft.cancel();
      vi.advanceTimersByTime(2000);
      expect(stored(key)?.panel.title).toBe("now");
    });

    it("flush with nothing pending writes nothing", () => {
      const key = `${PREFIX}acme.d1.p1`;
      usePanelDraft(computed(() => key)).flush();
      expect(stored(key)).toBeNull();
    });
  });

  describe("read", () => {
    const seed = (key: string, savedAt: number) =>
      localStorage.setItem(key, JSON.stringify({ ...content(key), savedAt }));

    it("drops drafts older than 7 days", () => {
      const key = `${PREFIX}acme.d1.p1`;
      seed(key, Date.now() - PANEL_DRAFT_MAX_AGE_MS - 1);
      seed(`${PREFIX}acme.d2.p2`, Date.now() - 1000);

      expect(usePanelDraft(computed(() => key)).read()).toBeUndefined();
      expect(draftKeys()).toEqual([`${PREFIX}acme.d2.p2`]);
    });

    it("keeps the newest 20 drafts and evicts the oldest", () => {
      for (let i = 0; i < PANEL_DRAFT_MAX_COUNT + 3; i++) {
        seed(`${PREFIX}acme.d1.p${i}`, Date.now() - (PANEL_DRAFT_MAX_COUNT + 3 - i) * 1000);
      }
      const newest = `${PREFIX}acme.d1.p${PANEL_DRAFT_MAX_COUNT + 2}`;
      const entry = usePanelDraft(computed(() => newest)).read();

      expect(entry?.key).toBe(newest);
      expect(draftKeys()).toHaveLength(PANEL_DRAFT_MAX_COUNT);
      expect(localStorage.getItem(`${PREFIX}acme.d1.p0`)).toBeNull();
      expect(localStorage.getItem(`${PREFIX}acme.d1.p2`)).toBeNull();
      expect(localStorage.getItem(`${PREFIX}acme.d1.p3`)).not.toBeNull();
    });

    it("evicts the oldest on save once the cap is reached", () => {
      for (let i = 0; i < PANEL_DRAFT_MAX_COUNT; i++) {
        seed(`${PREFIX}acme.d1.p${i}`, Date.now() - (PANEL_DRAFT_MAX_COUNT - i) * 1000);
      }
      const key = `${PREFIX}acme.d9.p9`;
      const draft = usePanelDraft(computed(() => key));
      draft.save(() => content("new"));
      draft.flush();

      expect(draftKeys()).toHaveLength(PANEL_DRAFT_MAX_COUNT);
      expect(localStorage.getItem(`${PREFIX}acme.d1.p0`)).toBeNull();
      expect(stored(key)?.panel.title).toBe("new");
    });

    it("drops an unreadable draft", () => {
      const key = `${PREFIX}acme.d1.p1`;
      localStorage.setItem(key, "{not json");
      expect(usePanelDraft(computed(() => key)).read()).toBeUndefined();
      expect(localStorage.getItem(key)).toBeNull();
    });

    it("offers the newest new-panel draft of the same dashboard left by another tab", () => {
      seed(`${PREFIX}acme.d1.new:closed-tab-1`, Date.now() - 5000);
      seed(`${PREFIX}acme.d1.new:closed-tab-2`, Date.now() - 1000);
      seed(`${PREFIX}acme.d2.new:other-dashboard`, Date.now());

      const own = panelDraftKey("acme", "d1");
      expect(usePanelDraft(computed(() => own)).read()?.key).toBe(
        `${PREFIX}acme.d1.new:closed-tab-2`,
      );
    });

    it("never offers a new-panel draft to an existing panel", () => {
      seed(`${PREFIX}acme.d1.new:closed-tab`, Date.now());
      expect(usePanelDraft(computed(() => `${PREFIX}acme.d1.p1`)).read()).toBeUndefined();
    });
  });

  describe("storage unavailable", () => {
    it("reports unavailable when the probe write throws, and then never touches storage", () => {
      const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
      const getItem = vi.spyOn(Storage.prototype, "getItem");
      const error = vi.spyOn(console, "error");
      const key = `${PREFIX}acme.d1.p1`;
      const draft = usePanelDraft(computed(() => key));

      expect(draft.available.value).toBe(false);
      draft.save(() => content("x"));
      vi.advanceTimersByTime(1000);
      expect(draft.read()).toBeUndefined();
      draft.remove();
      expect(setItem).toHaveBeenCalledTimes(1);
      expect(getItem).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });

    it("turns unavailable on the first QuotaExceeded write without throwing", () => {
      const key = `${PREFIX}acme.d1.p1`;
      const draft = usePanelDraft(computed(() => key));
      expect(draft.available.value).toBe(true);
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });

      draft.save(() => content("x"));
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
      expect(draft.available.value).toBe(false);
      expect(draft.write({ key, draft: { ...content("y"), savedAt: 1 } })).toBe(false);
    });
  });

  describe("Undo hand-off", () => {
    it("hands the requested entry to the matching key once", () => {
      const entry = { key: `${PREFIX}acme.d1.p1`, draft: { ...content("u"), savedAt: 1 } };
      requestDraftRestore(entry);
      expect(takeDraftRestore(`${PREFIX}acme.d1.p2`)).toBeUndefined();
      requestDraftRestore(entry);
      expect(takeDraftRestore(entry.key)).toEqual(entry);
      expect(takeDraftRestore(entry.key)).toBeUndefined();
    });
  });
});
