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
import { writePanelDraft, type PanelDraftInput } from "@/composables/dashboard/usePanelDraft";
import {
  EDITOR_DRAFT_MAX_PER_KIND,
  EDITOR_DRAFT_PREFIX,
  EDITOR_DRAFT_TTL_MS,
  cleanupEditorDrafts,
  clearEditorDraftsFor,
  countEditorDraftsFor,
  EDITOR_DRAFT_INDEX_KEY,
  countAllDraftsFor,
  editorDraftSessionEnded,
  endEditorDraftSession,
  resumeEditorDraftSession,
  deleteEditorDraft,
  deleteEditorDraftsFor,
  editorDraftKey,
  editorDraftRevision,
  hasEditorDraft,
  hashDraftValue,
  isEditorDraftStorageAvailable,
  listEditorDraftIds,
  listEditorDrafts,
  readEditorDraft,
  stableStringify,
  writeEditorDraft,
  type EditorDraftScope,
} from "./editorDraftStore";

const scope: EditorDraftScope = {
  kind: "function",
  org: "org1",
  entityId: "fn1",
  userEmail: "me@x.io",
};
const newScope: EditorDraftScope = { ...scope, entityId: null };

const storeRaw = (target: EditorDraftScope, savedAt: number, v = 1) =>
  localStorage.setItem(editorDraftKey(target), JSON.stringify({ v, savedAt, data: {} }));

const draftKeyCount = () =>
  Object.keys(localStorage).filter((key) => key.startsWith(EDITOR_DRAFT_PREFIX)).length;

const quotaError = () => new DOMException("full", "QuotaExceededError");

describe("editorDraftStore", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  describe("keys", () => {
    it("joins kind, org, entity id and email, each URI-encoded so none contains a colon", () => {
      expect(editorDraftKey(scope)).toBe("o2_draft:function:org1:fn1:me%40x.io");
      expect(editorDraftKey({ ...scope, org: "a:b", entityId: "x/y:z" })).toBe(
        "o2_draft:function:a%3Ab:x%2Fy%3Az:me%40x.io",
      );
    });

    it("uses new for the new-item draft and keeps an item named new apart from it", () => {
      expect(editorDraftKey(newScope)).toBe("o2_draft:function:org1:new:me%40x.io");
      expect(editorDraftKey({ ...scope, entityId: "" })).toBe(editorDraftKey(newScope));
      expect(editorDraftKey({ ...scope, entityId: "new" })).not.toBe(editorDraftKey(newScope));
    });

    it("gives each new-item variant its own slot and ignores a variant on a saved item", () => {
      expect(editorDraftKey({ ...newScope, variant: "tcp" })).toBe(
        "o2_draft:function:org1:new~tcp:me%40x.io",
      );
      expect(editorDraftKey({ ...newScope, variant: null })).toBe(editorDraftKey(newScope));
      expect(editorDraftKey({ ...scope, variant: "tcp" })).toBe(editorDraftKey(scope));
      expect(editorDraftKey({ ...scope, entityId: "new~tcp" })).not.toBe(
        editorDraftKey({ ...newScope, variant: "tcp" }),
      );
    });
  });

  describe("read and write", () => {
    it("writes the v1 shape and reads it back", () => {
      expect(
        writeEditorDraft(scope, {
          data: { a: 1 },
          baseHash: "abc",
          redactedPaths: ["/p"],
          redactedLabels: { "/p": "label" },
        }),
      ).toBe(true);
      const draft = readEditorDraft(scope);
      expect(draft).toMatchObject({
        v: 1,
        data: { a: 1 },
        baseHash: "abc",
        redactedPaths: ["/p"],
        redactedLabels: { "/p": "label" },
      });
      expect(typeof draft?.savedAt).toBe("number");
    });

    it("omits an empty base hash and empty redacted paths", () => {
      writeEditorDraft(scope, { data: 1, redactedPaths: [], redactedLabels: {} });
      const stored = JSON.parse(localStorage.getItem(editorDraftKey(scope)) ?? "{}");
      expect(stored).not.toHaveProperty("baseHash");
      expect(stored).not.toHaveProperty("redactedPaths");
      expect(stored).not.toHaveProperty("redactedLabels");
    });

    it("keeps the new-item draft apart from a saved item's draft", () => {
      writeEditorDraft(newScope, { data: "new" });
      writeEditorDraft(scope, { data: "saved" });
      expect(readEditorDraft(newScope)?.data).toBe("new");
      expect(readEditorDraft(scope)?.data).toBe("saved");
    });

    it("drops an expired draft on read", () => {
      storeRaw(scope, Date.now() - EDITOR_DRAFT_TTL_MS - 1);
      expect(readEditorDraft(scope)).toBeNull();
      expect(localStorage.getItem(editorDraftKey(scope))).toBeNull();
    });

    it("drops unreadable and old-version drafts on read", () => {
      localStorage.setItem(editorDraftKey(scope), "{nope");
      expect(readEditorDraft(scope)).toBeNull();
      storeRaw(scope, Date.now(), 0);
      expect(readEditorDraft(scope)).toBeNull();
      expect(draftKeyCount()).toBe(0);
    });

    it("answers has without writing", () => {
      expect(hasEditorDraft(scope)).toBe(false);
      writeEditorDraft(scope, { data: {} });
      expect(hasEditorDraft(scope)).toBe(true);
      deleteEditorDraft(scope);
      expect(hasEditorDraft(scope)).toBe(false);
    });
  });

  describe("quota", () => {
    it("prunes and retries once when storage is full", () => {
      for (let i = 0; i < EDITOR_DRAFT_MAX_PER_KIND; i++) {
        storeRaw({ ...scope, entityId: `old${i}` }, Date.now() - 1000 - i);
      }
      const original = Storage.prototype.setItem;
      let failures = 1;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
        this: Storage,
        key: string,
        value: string,
      ) {
        if (key === editorDraftKey(scope) && failures-- > 0) throw quotaError();
        return original.call(this, key, value);
      });

      expect(writeEditorDraft(scope, { data: {} })).toBe(true);
      expect(readEditorDraft(scope)).not.toBeNull();
      expect(draftKeyCount()).toBeLessThan(EDITOR_DRAFT_MAX_PER_KIND);
    });

    it("makes room only among the writer's own drafts of that kind and org", () => {
      const others = [
        { ...scope, userEmail: "other@x.io" },
        { ...scope, org: "org2" },
        { ...scope, kind: "alert" as const },
      ];
      others.forEach((target, i) =>
        storeRaw({ ...target, entityId: `keep${i}` }, Date.now() - 5000),
      );
      for (let i = 0; i < EDITOR_DRAFT_MAX_PER_KIND; i++) {
        storeRaw({ ...scope, entityId: `old${i}` }, Date.now() - 1000 - i);
      }
      const original = Storage.prototype.setItem;
      let failures = 1;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
        this: Storage,
        key: string,
        value: string,
      ) {
        if (key === editorDraftKey(scope) && failures-- > 0) throw quotaError();
        return original.call(this, key, value);
      });

      expect(writeEditorDraft(scope, { data: {} })).toBe(true);
      others.forEach((target, i) =>
        expect(readEditorDraft({ ...target, entityId: `keep${i}` })).not.toBeNull(),
      );
    });

    it("returns false when storage is still full after pruning", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw quotaError();
      });
      expect(writeEditorDraft(scope, { data: {} })).toBe(false);
    });

    it("reports blocked storage as unavailable", () => {
      vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      expect(isEditorDraftStorageAvailable()).toBe(false);
      expect(writeEditorDraft(scope, { data: {} })).toBe(false);
      expect(readEditorDraft(scope)).toBeNull();
    });
  });

  describe("cleanup", () => {
    it("caps each kind at its newest drafts without touching other kinds", () => {
      const now = Date.now();
      for (let i = 0; i < EDITOR_DRAFT_MAX_PER_KIND + 3; i++) {
        storeRaw({ ...scope, entityId: `fn${i}` }, now - i);
      }
      storeRaw({ ...scope, kind: "alert", entityId: "a1" }, now - 10_000);

      expect(cleanupEditorDrafts(now)).toBe(3);
      expect(listEditorDraftIds("function", "org1", "me@x.io")).toHaveLength(
        EDITOR_DRAFT_MAX_PER_KIND,
      );
      expect(readEditorDraft({ ...scope, entityId: "fn0" })).not.toBeNull();
      expect(readEditorDraft({ ...scope, entityId: `fn${EDITOR_DRAFT_MAX_PER_KIND}` })).toBeNull();
      expect(readEditorDraft({ ...scope, kind: "alert", entityId: "a1" })).not.toBeNull();
    });

    it("caps each user's drafts per kind and org, never evicting another user's or org's", () => {
      for (let i = 0; i < 3; i++) storeRaw({ ...scope, entityId: `mine${i}` }, Date.now() - i);
      storeRaw({ ...scope, userEmail: "other@x.io", entityId: "theirs" }, Date.now() - 100);
      storeRaw({ ...scope, org: "org2", entityId: "elsewhere" }, Date.now() - 100);
      expect(cleanupEditorDrafts(Date.now(), 2)).toBe(1);
      expect(readEditorDraft({ ...scope, entityId: "mine2" })).toBeNull();
      expect(
        readEditorDraft({ ...scope, userEmail: "other@x.io", entityId: "theirs" }),
      ).not.toBeNull();
      expect(readEditorDraft({ ...scope, org: "org2", entityId: "elsewhere" })).not.toBeNull();
    });

    it("removes expired, unreadable and malformed-key drafts", () => {
      storeRaw(scope, Date.now() - EDITOR_DRAFT_TTL_MS - 1);
      localStorage.setItem(`${EDITOR_DRAFT_PREFIX}broken`, JSON.stringify({ v: 1, savedAt: 1 }));
      storeRaw(newScope, Date.now());
      expect(cleanupEditorDrafts()).toBe(2);
      expect(draftKeyCount()).toBe(1);
    });

    it("leaves panel drafts alone", () => {
      localStorage.setItem("o2_panel_draft:me@x.io:o:d:new", "{}");
      clearEditorDraftsFor("me@x.io");
      cleanupEditorDrafts();
      expect(localStorage.getItem("o2_panel_draft:me@x.io:o:d:new")).toBe("{}");
    });
  });

  describe("revision", () => {
    it("bumps on write and delete, and on a draft key changed in another tab", () => {
      const start = editorDraftRevision.value;
      writeEditorDraft(scope, { data: {} });
      deleteEditorDraft(scope);
      expect(editorDraftRevision.value).toBe(start + 2);

      window.dispatchEvent(new StorageEvent("storage", { key: editorDraftKey(scope) }));
      expect(editorDraftRevision.value).toBe(start + 3);

      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
      expect(editorDraftRevision.value).toBe(start + 3);

      window.dispatchEvent(new StorageEvent("storage", { key: null }));
      expect(editorDraftRevision.value).toBe(start + 4);
    });

    it("does not bump when deleting a draft that is not stored", () => {
      const start = editorDraftRevision.value;
      deleteEditorDraft(scope);
      expect(editorDraftRevision.value).toBe(start);
    });
  });

  describe("listing and bulk delete", () => {
    it("lists one user's drafts of one kind and org, newest first", () => {
      const now = Date.now();
      storeRaw(scope, now - 2);
      storeRaw(newScope, now - 1);
      storeRaw({ ...scope, entityId: "new" }, now - 3);
      storeRaw({ ...scope, userEmail: "other@x.io", entityId: "fn2" }, now);
      storeRaw({ ...scope, org: "org2", entityId: "fn3" }, now);
      storeRaw({ ...scope, kind: "alert", entityId: "a1" }, now);
      storeRaw({ ...newScope, variant: "tcp" }, now - 4);
      storeRaw({ ...scope, entityId: "new~tcp" }, now - 5);

      expect(listEditorDrafts("function", "org1", "me@x.io")).toEqual([
        { entityId: null, variant: null, savedAt: now - 1 },
        { entityId: "fn1", variant: null, savedAt: now - 2 },
        { entityId: "new", variant: null, savedAt: now - 3 },
        { entityId: null, variant: "tcp", savedAt: now - 4 },
        { entityId: "new~tcp", variant: null, savedAt: now - 5 },
      ]);
      expect(listEditorDraftIds("function", "org1", "me@x.io")).toEqual(["fn1", "new", "new~tcp"]);
    });

    it("deletes every user's variant drafts of a deleted source, exact variant only", () => {
      const clone = { ...newScope, variant: "clone:fn1" };
      writeEditorDraft(clone, { data: {} });
      writeEditorDraft({ ...clone, userEmail: "other@x.io" }, { data: {} });
      writeEditorDraft({ ...newScope, variant: "clone:fn10" }, { data: {} });
      writeEditorDraft(newScope, { data: {} });

      expect(
        deleteEditorDraftsFor({
          kind: "function",
          org: "org1",
          entityId: "fn1",
          variant: "clone:fn1",
        }),
      ).toBe(2);
      expect(readEditorDraft({ ...newScope, variant: "clone:fn10" })).not.toBeNull();
      expect(readEditorDraft(newScope)).not.toBeNull();
    });

    it("deletes every user's drafts a match rule picks, saved and new alike", () => {
      writeEditorDraft({ ...scope, entityId: "team_1/rot_a" }, { data: {} });
      writeEditorDraft({ ...newScope, variant: "team_1/new" }, { data: {} });
      writeEditorDraft(
        { ...newScope, variant: "team_1/new", userEmail: "other@x.io" },
        { data: {} },
      );
      writeEditorDraft({ ...scope, entityId: "team_10/rot_a" }, { data: {} });

      const removed = deleteEditorDraftsFor({
        kind: "function",
        org: "org1",
        match: ({ entityId, variant }) => (entityId ?? variant ?? "").startsWith("team_1/"),
      });
      expect(removed).toBe(3);
      expect(readEditorDraft({ ...scope, entityId: "team_10/rot_a" })).not.toBeNull();
    });

    it("deletes one item's drafts for every user in the org", () => {
      writeEditorDraft(scope, { data: {} });
      writeEditorDraft({ ...scope, userEmail: "other@x.io" }, { data: {} });
      writeEditorDraft({ ...scope, entityId: "fn2" }, { data: {} });
      writeEditorDraft({ ...scope, org: "org2" }, { data: {} });
      writeEditorDraft(newScope, { data: {} });

      expect(deleteEditorDraftsFor({ kind: "function", org: "org1", entityId: "fn1" })).toBe(2);
      expect(readEditorDraft({ ...scope, entityId: "fn2" })).not.toBeNull();
      expect(readEditorDraft({ ...scope, org: "org2" })).not.toBeNull();
      expect(readEditorDraft(newScope)).not.toBeNull();
    });

    it("ends the draft session: clears that user's drafts only, and refuses writes until it resumes", () => {
      writeEditorDraft(scope, { data: {} });
      const other = { ...scope, userEmail: "other@x.io" };
      writeEditorDraft(other, { data: {} });
      endEditorDraftSession(scope.userEmail);
      expect(readEditorDraft(scope)).toBeNull();
      expect(readEditorDraft(other)).not.toBeNull();
      localStorage.removeItem(editorDraftKey(other));
      expect(editorDraftSessionEnded.value).toBe(true);
      expect(writeEditorDraft(scope, { data: {} })).toBe(false);
      expect(draftKeyCount()).toBe(0);

      resumeEditorDraftSession();
      expect(writeEditorDraft(scope, { data: {} })).toBe(true);
    });

    it("refuses panel draft writes too once the session ends", () => {
      const panelScope = { userEmail: "me@x.io", org: "org1", dashboardId: "d", panelId: "p" };
      const input: PanelDraftInput = {
        tabId: "t",
        data: {},
        layout: { currentQueryIndex: 0, vrlFunctionToggle: false },
        sessionVariables: [],
        variablesWithCurrentPanel: [],
      };
      endEditorDraftSession(scope.userEmail);
      expect(writePanelDraft(panelScope, input)).toBe(false);
      resumeEditorDraftSession();
      expect(writePanelDraft(panelScope, input)).toBe(true);
    });

    it("counts one user's editor and panel drafts across kinds and orgs", () => {
      writeEditorDraft(scope, { data: {} });
      writeEditorDraft({ ...scope, kind: "alert", org: "org2" }, { data: {} });
      writeEditorDraft({ ...scope, userEmail: "other@x.io" }, { data: {} });
      localStorage.setItem(
        `o2_panel_draft:${scope.userEmail}:org1:d1:p1`,
        JSON.stringify({ v: 1, savedAt: Date.now(), tabId: "t", data: {} }),
      );
      expect(countAllDraftsFor(scope.userEmail)).toBe(3);
      expect(countAllDraftsFor("nobody@x.io")).toBe(0);
    });

    it("clears one user's editor drafts and nothing else", () => {
      writeEditorDraft(scope, { data: {} });
      writeEditorDraft({ ...scope, kind: "alert" }, { data: {} });
      writeEditorDraft({ ...scope, userEmail: "other@x.io" }, { data: {} });
      localStorage.setItem("unrelated", "keep");
      clearEditorDraftsFor(scope.userEmail);
      expect(draftKeyCount()).toBe(1);
      expect(readEditorDraft({ ...scope, userEmail: "other@x.io" })).not.toBeNull();
      expect(localStorage.getItem("unrelated")).toBe("keep");
    });
  });

  describe("hashing", () => {
    it("ignores key order and changes with any value", () => {
      expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
        '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}',
      );
      expect(hashDraftValue({ a: 1, b: 2 })).toBe(hashDraftValue({ b: 2, a: 1 }));
      expect(hashDraftValue({ a: 1, b: 2 })).not.toBe(hashDraftValue({ a: 1, b: 3 }));
      expect(hashDraftValue("x")).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe("index", () => {
    it("lists and counts without parsing any draft, once the index is built", () => {
      writeEditorDraft(scope, { data: { big: "x".repeat(1000) } });
      writeEditorDraft({ ...scope, entityId: "fn2" }, { data: {} });
      listEditorDrafts("function", "org1", "me@x.io");
      const getItem = vi.spyOn(Storage.prototype, "getItem");
      expect(listEditorDrafts("function", "org1", "me@x.io")).toHaveLength(2);
      expect(countEditorDraftsFor("me@x.io")).toBe(2);
      const draftReads = getItem.mock.calls.filter(([key]) => key.startsWith(EDITOR_DRAFT_PREFIX));
      expect(draftReads).toHaveLength(0);
    });

    it("keeps the index in step with writes and deletes", () => {
      writeEditorDraft(scope, { data: {} });
      const index = () => JSON.parse(localStorage.getItem(EDITOR_DRAFT_INDEX_KEY) ?? "{}");
      expect(Object.keys(index())).toEqual([editorDraftKey(scope)]);
      deleteEditorDraft(scope);
      expect(localStorage.getItem(EDITOR_DRAFT_INDEX_KEY)).toBeNull();
      expect(localStorage.length).toBe(0);
    });

    it("picks up another tab's draft and index on its storage event", () => {
      writeEditorDraft(scope, { data: {} });
      expect(listEditorDrafts("function", "org1", "me@x.io")).toHaveLength(1);
      const otherTab = { ...scope, entityId: "other-tab" };
      storeRaw(otherTab, Date.now());
      const index = JSON.parse(localStorage.getItem(EDITOR_DRAFT_INDEX_KEY) ?? "{}");
      index[editorDraftKey(otherTab)] = Date.now();
      localStorage.setItem(EDITOR_DRAFT_INDEX_KEY, JSON.stringify(index));
      const start = editorDraftRevision.value;

      window.dispatchEvent(new StorageEvent("storage", { key: EDITOR_DRAFT_INDEX_KEY }));

      expect(editorDraftRevision.value).toBe(start + 1);
      expect(listEditorDrafts("function", "org1", "me@x.io").map((d) => d.entityId)).toContain(
        "other-tab",
      );
    });

    it("rebuilds a missing or corrupt index from the drafts themselves", () => {
      writeEditorDraft(scope, { data: {} });
      localStorage.setItem(EDITOR_DRAFT_INDEX_KEY, "{not json");
      expect(listEditorDrafts("function", "org1", "me@x.io")).toHaveLength(1);
      localStorage.removeItem(EDITOR_DRAFT_INDEX_KEY);
      storeRaw({ ...scope, entityId: "written-elsewhere" }, Date.now());
      expect(listEditorDrafts("function", "org1", "me@x.io")).toHaveLength(2);
      expect(JSON.parse(localStorage.getItem(EDITOR_DRAFT_INDEX_KEY) ?? "{}")).toHaveProperty(
        editorDraftKey({ ...scope, entityId: "written-elsewhere" }),
      );
    });
  });
});
