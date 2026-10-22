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
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import {
  PANEL_DRAFT_AUTOSAVE_MS,
  PANEL_DRAFT_MAX,
  PANEL_DRAFT_PREFIX,
  PANEL_DRAFT_TTL_MS,
  PANEL_DRAFT_VERSION,
  cleanupPanelDrafts,
  clearAllPanelDrafts,
  deletePanelDraft,
  deletePanelDraftsFor,
  formatPanelDraftTime,
  hasPanelDraft,
  isPanelDraftStorageAvailable,
  panelDraftKey,
  panelDraftRevision,
  readPanelDraft,
  usePanelDraftAutosave,
  writePanelDraft,
  type PanelDraftAutosaveOptions,
  type PanelDraftInput,
} from "./usePanelDraft";

const scope = { userEmail: "me@x.io", org: "org1", dashboardId: "dash1" };
const panelScope = { ...scope, panelId: "p1" };

const input = (title = "Draft"): PanelDraftInput => ({
  tabId: "t1",
  data: { title, queries: [] },
  layout: { currentQueryIndex: 0, vrlFunctionToggle: false },
  sessionVariables: [],
  variablesWithCurrentPanel: [],
});

const store = (key: string, savedAt: number, v = PANEL_DRAFT_VERSION) =>
  localStorage.setItem(key, JSON.stringify({ ...input(), v, savedAt }));

const draftKeyCount = () =>
  Object.keys(localStorage).filter((key) => key.startsWith(PANEL_DRAFT_PREFIX)).length;

const quotaError = () => new DOMException("full", "QuotaExceededError");

describe("usePanelDraft storage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("builds one key per panel and one new-panel key per dashboard", () => {
    expect(panelDraftKey(scope)).toBe("o2_panel_draft:me@x.io:org1:dash1:new");
    expect(panelDraftKey({ ...scope, panelId: null })).toBe(panelDraftKey(scope));
    expect(panelDraftKey(panelScope)).toBe("o2_panel_draft:me@x.io:org1:dash1:p1");
  });

  it("writes and reads a draft with its format version and save time", () => {
    expect(writePanelDraft(panelScope, input("Edited"))).toBe(true);

    const draft = readPanelDraft(panelScope);
    expect(draft?.data.title).toBe("Edited");
    expect(draft?.v).toBe(PANEL_DRAFT_VERSION);
    expect(typeof draft?.savedAt).toBe("number");
    expect(readPanelDraft(scope)).toBeNull();
  });

  it("drops a draft written in another format version", () => {
    store(panelDraftKey(panelScope), Date.now(), PANEL_DRAFT_VERSION + 1);

    expect(readPanelDraft(panelScope)).toBeNull();
    expect(localStorage.getItem(panelDraftKey(panelScope))).toBeNull();
  });

  it("drops a draft older than seven days", () => {
    store(panelDraftKey(panelScope), Date.now() - PANEL_DRAFT_TTL_MS - 1);

    expect(readPanelDraft(panelScope)).toBeNull();
    expect(localStorage.getItem(panelDraftKey(panelScope))).toBeNull();
  });

  it("clean-up removes expired, unreadable and old-format drafts but leaves other keys", () => {
    const now = Date.now();
    store(`${PANEL_DRAFT_PREFIX}a`, now);
    store(`${PANEL_DRAFT_PREFIX}old`, now - PANEL_DRAFT_TTL_MS - 1);
    store(`${PANEL_DRAFT_PREFIX}v0`, now, 0);
    localStorage.setItem(`${PANEL_DRAFT_PREFIX}junk`, "{not json");
    localStorage.setItem("unrelated", "keep");

    expect(cleanupPanelDrafts(now)).toBe(3);
    expect(localStorage.getItem(`${PANEL_DRAFT_PREFIX}a`)).not.toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("keeps at most 20 drafts, dropping the oldest first", () => {
    const now = Date.now();
    for (let i = 0; i < PANEL_DRAFT_MAX + 2; i++) store(`${PANEL_DRAFT_PREFIX}d${i}`, now - i);

    cleanupPanelDrafts(now);

    expect(draftKeyCount()).toBe(PANEL_DRAFT_MAX);
    expect(localStorage.getItem(`${PANEL_DRAFT_PREFIX}d0`)).not.toBeNull();
    expect(localStorage.getItem(`${PANEL_DRAFT_PREFIX}d${PANEL_DRAFT_MAX}`)).toBeNull();
    expect(localStorage.getItem(`${PANEL_DRAFT_PREFIX}d${PANEL_DRAFT_MAX + 1}`)).toBeNull();
  });

  it("a write does not run the clean-up; the editor runs it once per mount", () => {
    const now = Date.now();
    for (let i = 0; i < PANEL_DRAFT_MAX; i++) store(`${PANEL_DRAFT_PREFIX}d${i}`, now - 1000 - i);

    writePanelDraft(panelScope, input());
    expect(draftKeyCount()).toBe(PANEL_DRAFT_MAX + 1);

    cleanupPanelDrafts();
    expect(draftKeyCount()).toBe(PANEL_DRAFT_MAX);
    expect(readPanelDraft(panelScope)).not.toBeNull();
    expect(localStorage.getItem(`${PANEL_DRAFT_PREFIX}d${PANEL_DRAFT_MAX - 1}`)).toBeNull();
  });

  it("prunes and retries once when storage is full", () => {
    const now = Date.now();
    for (let i = 0; i < PANEL_DRAFT_MAX; i++) store(`${PANEL_DRAFT_PREFIX}d${i}`, now - 1000 - i);
    const original = Storage.prototype.setItem;
    let failures = 1;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === panelDraftKey(panelScope) && failures-- > 0) throw quotaError();
      return original.call(this, key, value);
    });

    expect(writePanelDraft(panelScope, input())).toBe(true);
    expect(readPanelDraft(panelScope)).not.toBeNull();
    expect(draftKeyCount()).toBeLessThan(PANEL_DRAFT_MAX);
  });

  it("gives up quietly when storage is still full after pruning", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw quotaError();
    });

    expect(writePanelDraft(panelScope, input())).toBe(false);
  });

  it("turns the feature off when storage is blocked", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    expect(isPanelDraftStorageAvailable()).toBe(false);
    expect(writePanelDraft(panelScope, input())).toBe(false);
    expect(readPanelDraft(panelScope)).toBeNull();
    expect(hasPanelDraft(panelScope)).toBe(false);
    expect(() => deletePanelDraft(panelScope)).not.toThrow();
    expect(() => clearAllPanelDrafts()).not.toThrow();
    expect(cleanupPanelDrafts()).toBe(0);
  });

  it("reports storage as available when a probe write succeeds", () => {
    expect(isPanelDraftStorageAvailable()).toBe(true);
    expect(draftKeyCount()).toBe(0);
  });

  it("bumps the shared revision on write, delete and another tab's storage event", () => {
    const start = panelDraftRevision.value;

    writePanelDraft(scope, input());
    expect(panelDraftRevision.value).toBe(start + 1);
    deletePanelDraft(scope);
    expect(panelDraftRevision.value).toBe(start + 2);

    window.dispatchEvent(new StorageEvent("storage", { key: panelDraftKey(panelScope) }));
    expect(panelDraftRevision.value).toBe(start + 3);
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(panelDraftRevision.value).toBe(start + 3);
  });

  it("hasPanelDraft has no side effects: no listeners, no writes, no revision bump", () => {
    writePanelDraft(scope, input());
    const addListener = vi.spyOn(window, "addEventListener");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const revision = panelDraftRevision.value;

    expect(hasPanelDraft(scope)).toBe(true);
    expect(hasPanelDraft(panelScope)).toBe(false);

    expect(addListener).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(panelDraftRevision.value).toBe(revision);
  });

  it("hasPanelDraft sees a live draft without deleting a stale one", () => {
    writePanelDraft(scope, input());
    store(panelDraftKey(panelScope), Date.now() - PANEL_DRAFT_TTL_MS - 1);

    expect(hasPanelDraft(scope)).toBe(true);
    expect(hasPanelDraft(panelScope)).toBe(false);
    expect(localStorage.getItem(panelDraftKey(panelScope))).not.toBeNull();
  });

  it("deletes one panel's drafts for every user, or all drafts of a dashboard", () => {
    const other = { ...panelScope, userEmail: "you@x.io" };
    const otherDash = { ...panelScope, dashboardId: "dash2" };
    const otherOrg = { ...panelScope, org: "org2" };
    [scope, panelScope, other, otherDash, otherOrg, { ...scope, panelId: "p2" }].forEach((s) =>
      writePanelDraft(s, input()),
    );
    const start = panelDraftRevision.value;

    expect(deletePanelDraftsFor({ org: "org1", dashboardId: "dash1", panelId: "p1" })).toBe(2);
    expect(panelDraftRevision.value).toBe(start + 1);
    expect(readPanelDraft(panelScope)).toBeNull();
    expect(readPanelDraft(other)).toBeNull();
    expect(readPanelDraft(scope)).not.toBeNull();

    expect(deletePanelDraftsFor({ org: "org1", dashboardId: "dash1" })).toBe(2);
    expect(readPanelDraft(scope)).toBeNull();
    expect(readPanelDraft(otherDash)).not.toBeNull();
    expect(readPanelDraft(otherOrg)).not.toBeNull();

    const before = panelDraftRevision.value;
    expect(deletePanelDraftsFor({ org: "org1", dashboardId: "nothing" })).toBe(0);
    expect(panelDraftRevision.value).toBe(before);
  });

  it("clears every draft and nothing else", () => {
    writePanelDraft(scope, input());
    writePanelDraft(panelScope, input());
    localStorage.setItem("unrelated", "keep");

    clearAllPanelDrafts();

    expect(draftKeyCount()).toBe(0);
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("formats the save time to the minute", () => {
    const text = formatPanelDraftTime(Date.UTC(2026, 9, 21, 14, 32, 45), "en-US", "UTC");

    expect(text).toContain("2026");
    expect(text).toContain("2:32");
    expect(text).not.toContain("45");
  });
});

describe("usePanelDraftAutosave", () => {
  const state = { ready: true, changes: true };
  const write = vi.fn(() => true);
  const remove = vi.fn();
  const options: PanelDraftAutosaveOptions = {
    isReady: () => state.ready,
    hasChanges: () => state.changes,
    write,
    remove,
  };

  const mountAutosave = () => {
    let api: ReturnType<typeof usePanelDraftAutosave> | null = null;
    const wrapper = mount(
      defineComponent({
        setup() {
          api = usePanelDraftAutosave(options);
          return () => h("div");
        },
      }),
    );
    return { wrapper, api: api! };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    state.ready = true;
    state.changes = true;
    write.mockClear();
    remove.mockClear();
  });

  afterEach(() => vi.useRealTimers());

  it("writes once, a debounce after the last change", () => {
    const { wrapper, api } = mountAutosave();

    api.schedule();
    vi.advanceTimersByTime(PANEL_DRAFT_AUTOSAVE_MS - 1);
    api.schedule();
    vi.advanceTimersByTime(PANEL_DRAFT_AUTOSAVE_MS - 1);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(write).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("does nothing until the editor is ready", () => {
    state.ready = false;
    const { wrapper, api } = mountAutosave();

    api.schedule();
    vi.advanceTimersByTime(PANEL_DRAFT_AUTOSAVE_MS);

    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("deletes its own draft once the changes are undone", () => {
    const { wrapper, api } = mountAutosave();
    api.schedule();
    vi.advanceTimersByTime(PANEL_DRAFT_AUTOSAVE_MS);

    state.changes = false;
    api.schedule();
    vi.advanceTimersByTime(PANEL_DRAFT_AUTOSAVE_MS);

    expect(remove).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("leaves a draft it did not write alone when there is nothing to save", () => {
    state.changes = false;
    const { wrapper, api } = mountAutosave();

    api.schedule();
    vi.advanceTimersByTime(PANEL_DRAFT_AUTOSAVE_MS);
    expect(remove).not.toHaveBeenCalled();

    api.adopt();
    api.flush();
    expect(remove).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("drops a pending write when the editor unmounts", () => {
    const { wrapper, api } = mountAutosave();

    api.schedule();
    wrapper.unmount();
    vi.advanceTimersByTime(PANEL_DRAFT_AUTOSAVE_MS * 2);

    expect(write).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("beforeunload"));
    expect(write).not.toHaveBeenCalled();
  });

  it("writes silently and at once on beforeunload, pagehide and a hidden tab", () => {
    const { wrapper } = mountAutosave();

    window.dispatchEvent(new Event("beforeunload"));
    expect(write).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pagehide"));
    expect(write).toHaveBeenCalledTimes(2);

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(write).toHaveBeenCalledTimes(3);
    visibility.mockRestore();
    wrapper.unmount();
  });

  it("a refused write is not treated as stored, so undoing deletes nothing", () => {
    write.mockReturnValueOnce(false);
    const { wrapper, api } = mountAutosave();

    api.flush();
    expect(write).toHaveBeenCalledTimes(1);
    state.changes = false;
    api.flush();

    expect(remove).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("release forgets ownership and cancels a pending write", () => {
    const { wrapper, api } = mountAutosave();
    api.flush();
    api.schedule();

    api.release();
    state.changes = false;
    vi.advanceTimersByTime(PANEL_DRAFT_AUTOSAVE_MS);
    api.flush();

    expect(write).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
