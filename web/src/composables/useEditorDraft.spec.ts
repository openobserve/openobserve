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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import { createStore } from "vuex";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { raw } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import EditorDraftDialogs from "@/components/common/drafts/EditorDraftDialogs.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { beginDraftSignOut, cancelDraftSignOut } from "@/utils/drafts/draftSession";
import {
  deleteEditorDraft,
  endEditorDraftSession,
  hashDraftValue,
  resumeEditorDraftSession,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import {
  useEditorDraft,
  useEditorDraftIds,
  type EditorDraftController,
  type EditorDraftIds,
  type UseEditorDraftOptions,
} from "./useEditorDraft";

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return { ...actual, onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() };
});

vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>();
  return { ...actual, toast: vi.fn(() => () => {}) };
});

interface Form {
  name: string;
  password: string;
  tab: string;
}

type Guard = (to: { path: string }, from: { path: string }) => Promise<boolean> | boolean;

const editScope: EditorDraftScope = {
  kind: "function",
  org: "org1",
  entityId: "fn1",
  userEmail: "me@x.io",
};
const newScope: EditorDraftScope = { ...editScope, entityId: null };

let form: Form;
let server: Form | null;
let entityId: string | null;
let overrides: Partial<UseEditorDraftOptions<Form>>;
let store: ReturnType<typeof createStore>;
let wrapper: VueWrapper | null = null;

const save = vi.fn<() => Promise<boolean>>();
const apply = vi.fn((data: Form) => {
  Object.assign(form, data);
});

const mountHost = async () => {
  let draft!: EditorDraftController;
  const Host = defineComponent({
    setup() {
      draft = useEditorDraft<Form>({
        kind: "function",
        entityLabel: () => raw("function"),
        entityId: () => entityId,
        snapshot: () => ({ ...form }),
        apply,
        base: () => server,
        save,
        ...overrides,
      });
      return () =>
        h("div", [
          h("input", { "data-test": "host-field" }),
          h("div", { "aria-hidden": "true" }, [h("select", { "data-test": "host-hidden-select" })]),
          h(EditorDraftDialogs, { draft }),
        ]);
    },
  });
  wrapper = mount(Host, { attachTo: document.body, global: { plugins: [store] } });
  await nextTick();
  return draft;
};

const startHost = async () => {
  const draft = await mountHost();
  await draft.start();
  return draft;
};

const userInput = () => window.dispatchEvent(new Event("pointerdown"));

const edit = async (patch: Partial<Form>) => {
  Object.assign(form, patch);
  await nextTick();
};

const flushAutosave = () => window.dispatchEvent(new Event("pagehide"));

const leaveGuard = () => vi.mocked(onBeforeRouteLeave).mock.calls.at(-1)![0] as unknown as Guard;
const updateGuard = () => vi.mocked(onBeforeRouteUpdate).mock.calls.at(-1)![0] as unknown as Guard;

const leave = () => leaveGuard()({ path: "/elsewhere" }, { path: "/editor" });

const body = () => document.body;
const byTest = (id: string) => body().querySelector<HTMLElement>(`[data-test="${id}"]`);
const leaveDialogButton = (id: string) =>
  body().querySelector<HTMLElement>(`[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`);

const seed = (scope: EditorDraftScope, data: Partial<Form>, extra = {}) =>
  writeEditorDraft(scope, { data: { name: "", password: "", tab: "a", ...data }, ...extra });

describe("useEditorDraft", () => {
  beforeEach(() => {
    localStorage.clear();
    form = reactive({ name: "saved", password: "", tab: "a" });
    server = { name: "saved", password: "", tab: "a" };
    entityId = "fn1";
    overrides = {};
    save.mockReset();
    apply.mockClear();
    vi.mocked(toast).mockClear();
    store = createStore({
      state: {
        selectedOrganization: { identifier: "org1" },
        userInfo: { email: "me@x.io" },
        timezone: "UTC",
      },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
  });

  describe("baseline and autosave", () => {
    it("ignores changes made before the user's first input", async () => {
      const draft = await startHost();
      await edit({ name: "loaded later" });
      expect(draft.hasUnsavedChanges()).toBe(false);

      userInput();
      expect(draft.hasUnsavedChanges()).toBe(false);
      await edit({ name: "typed" });
      expect(draft.hasUnsavedChanges()).toBe(true);
    });

    it("writes the draft about a second after the last change", async () => {
      vi.useFakeTimers();
      await startHost();
      userInput();
      await edit({ name: "typed" });
      vi.advanceTimersByTime(900);
      expect(readEditorDraft(editScope)).toBeNull();
      vi.advanceTimersByTime(200);
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("typed");
    });

    it("writes at once when the page hides and stores the server hash", async () => {
      await startHost();
      userInput();
      await edit({ name: "typed" });
      flushAutosave();
      expect(readEditorDraft(editScope)?.baseHash).toBe(hashDraftValue(server));
    });

    it("deletes its own draft once every change is undone", async () => {
      await startHost();
      userInput();
      await edit({ name: "typed" });
      flushAutosave();
      expect(readEditorDraft(editScope)).not.toBeNull();

      await edit({ name: "saved" });
      flushAutosave();
      expect(readEditorDraft(editScope)).toBeNull();
    });

    it("never writes secrets and records where they were", async () => {
      await startHost();
      userInput();
      await edit({ password: "hunter2" });
      flushAutosave();
      const stored = readEditorDraft<Form>(editScope);
      expect(stored?.data.password).toBe("");
      expect(stored?.redactedPaths).toEqual(["/password"]);
      expect(localStorage.getItem(Object.keys(localStorage)[0])).not.toContain("hunter2");
    });

    it("applies the editor's extra redaction", async () => {
      overrides = {
        redact: (data) => ({ data: { ...data, tab: "" }, paths: ["/tab/0"] }),
      };
      await startHost();
      userInput();
      await edit({ name: "typed", tab: "b" });
      flushAutosave();
      expect(readEditorDraft(editScope)).toMatchObject({
        data: { tab: "" },
        redactedPaths: ["/tab/0"],
      });
    });

    it("lets the editor's own rule decide what counts as unsaved", async () => {
      let dirty = false;
      overrides = { hasChanges: () => dirty };
      const draft = await startHost();
      userInput();
      await edit({ tab: "b" });
      expect(draft.hasUnsavedChanges()).toBe(false);
      dirty = true;
      expect(draft.hasUnsavedChanges()).toBe(true);
    });

    it("writes a pending draft at unmount and nothing after it", async () => {
      vi.useFakeTimers();
      await startHost();
      userInput();
      await edit({ name: "typed" });
      wrapper?.unmount();
      wrapper = null;
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("typed");

      Object.assign(form, { name: "after unmount" });
      vi.advanceTimersByTime(2000);
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("typed");
    });

    it("drafts nothing the editor changes after a discard let it leave, until the user acts again", async () => {
      vi.useFakeTimers();
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      const result = leave();
      await flushPromises();
      draft.chooseLeave("discard");
      expect(await result).toBe(true);

      await edit({ name: "committed on the way out" });
      wrapper?.unmount();
      wrapper = null;
      vi.advanceTimersByTime(2000);
      expect(readEditorDraft(editScope)).toBeNull();
    });

    it("drafts again once the user acts after a leave that did not happen", async () => {
      const draft = await startHost();
      expect(await draft.confirmLeave()).toBe(true);
      await edit({ name: "ignored" });
      flushAutosave();
      expect(readEditorDraft(editScope)).toBeNull();

      userInput();
      await edit({ name: "typed" });
      flushAutosave();
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("typed");
    });

    it("writes nothing at unmount when no write is pending", async () => {
      await startHost();
      userInput();
      await edit({ name: "typed" });
      flushAutosave();
      deleteEditorDraft(editScope);
      wrapper?.unmount();
      wrapper = null;
      expect(readEditorDraft(editScope)).toBeNull();
    });

    it("builds no snapshot per change while the write is debounced", async () => {
      vi.useFakeTimers();
      const snapshot = vi.fn(() => ({ ...form }));
      overrides = { snapshot };
      await startHost();
      userInput();
      snapshot.mockClear();
      for (let i = 0; i < 50; i++) await edit({ name: `typed ${i}` });
      expect(snapshot.mock.calls.length).toBeLessThanOrEqual(1);

      vi.advanceTimersByTime(1100);
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("typed 49");
      expect(snapshot.mock.calls.length).toBeLessThanOrEqual(4);
    });

    describe("state the snapshot reaches only after a change", () => {
      type Row = { v: string };
      let rows: Row[];
      const rowsOf = () => readEditorDraft<Form & { rows: Row[] }>(editScope)?.data.rows;

      beforeEach(() => {
        rows = reactive<Row[]>([]);
        // Holds the rows by reference, so only a deep read tracks a row's own field.
        overrides = { snapshot: () => Object.assign({ ...form }, { rows }) };
      });

      it("drafts a later change to a row added since the last snapshot", async () => {
        vi.useFakeTimers();
        await startHost();
        userInput();
        rows.push({ v: "a" });
        await nextTick();
        vi.advanceTimersByTime(1100);
        expect(rowsOf()).toEqual([{ v: "a" }]);

        rows[0].v = "b";
        await nextTick();
        vi.advanceTimersByTime(1100);
        expect(rowsOf()).toEqual([{ v: "b" }]);
      });

      it("drafts a change to such a row after a discard cancelled the pending write", async () => {
        vi.useFakeTimers();
        const draft = await startHost();
        userInput();
        rows.push({ v: "a" });
        await nextTick();
        draft.discard();
        expect(readEditorDraft(editScope)).toBeNull();

        rows[0].v = "b";
        await nextTick();
        vi.advanceTimersByTime(1100);
        expect(rowsOf()).toEqual([{ v: "b" }]);
      });
    });

    it("writes the pending draft under the old org when the org switches", async () => {
      await startHost();
      userInput();
      await edit({ name: "typed" });
      store.state.selectedOrganization = { identifier: "org2" };
      await nextTick();
      expect(readEditorDraft(editScope)).not.toBeNull();
      expect(await leave()).toBe(true);
    });
  });

  describe("restore dialog", () => {
    it("continues a draft through the real dialog and counts it as unsaved", async () => {
      seed(editScope, { name: "draft name" });
      const draft = await mountHost();
      const started = draft.start();
      await flushPromises();

      expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
      expect(byTest("editor-draft-restore-message")?.textContent).toContain(
        "unsaved changes to this function from",
      );
      byTest("editor-draft-continue")?.click();
      await started;

      expect(apply).toHaveBeenCalledWith(expect.objectContaining({ name: "draft name" }), {
        notKeptPaths: [],
      });
      expect(form.name).toBe("draft name");
      expect(draft.hasUnsavedChanges()).toBe(true);
    });

    it("restores a list entry's secret by its label, not its position", async () => {
      type Rows = { rows: { key: string; value: string }[] };
      const rows = reactive<Rows>({
        rows: [
          { key: "Authorization", value: "Bearer A" },
          { key: "X-Api-Key", value: "K" },
        ],
      });
      let host!: EditorDraftController;
      const Host = defineComponent({
        setup() {
          host = useEditorDraft<Rows>({
            kind: "function",
            entityLabel: () => raw("function"),
            entityId: () => "fn1",
            snapshot: () => JSON.parse(JSON.stringify(rows)) as Rows,
            apply: (data) => Object.assign(rows, data),
            base: () => ({ saved: true }),
            save: async () => true,
            redact: (data) => ({
              data: { rows: data.rows.map((row) => ({ ...row, value: "" })) },
              paths: data.rows.map((_row, index) => `/rows/${index}/value`),
            }),
          });
          return () => h(EditorDraftDialogs, { draft: host });
        },
      });
      wrapper = mount(Host, { attachTo: document.body, global: { plugins: [store] } });
      await host.start();
      userInput();
      rows.rows.splice(0, 1);
      await nextTick();
      flushAutosave();
      expect(readEditorDraft(editScope)?.redactedLabels).toEqual({ "/rows/0/value": "X-Api-Key" });
      wrapper.unmount();

      rows.rows = [
        { key: "Authorization", value: "Bearer A" },
        { key: "X-Api-Key", value: "K" },
      ];
      wrapper = mount(Host, { attachTo: document.body, global: { plugins: [store] } });
      const started = host.start();
      await flushPromises();
      host.chooseRestore("continue");
      await started;
      expect(rows.rows).toEqual([{ key: "X-Api-Key", value: "K" }]);
    });

    it("fills an unchanged blanked secret from the item as it is now, without a note", async () => {
      server = { name: "saved", password: "stored", tab: "a" };
      form.password = "stored";
      seed(
        editScope,
        { name: "draft", password: "" },
        { redactedPaths: ["/password"], changedRedactedPaths: [] },
      );
      const draft = await mountHost();
      const started = draft.start();
      await flushPromises();

      expect(draft.state.credentialsNotSaved).toBe(false);
      expect(byTest("editor-draft-credentials-not-saved")).toBeNull();
      draft.chooseRestore("continue");
      await started;
      expect(form).toMatchObject({ name: "draft", password: "stored" });
      expect(draft.pendingReentries()).toEqual([]);
    });

    it("leaves a changed secret blank, names it, and reports it until re-entered", async () => {
      overrides = { describeRedacted: (paths) => paths.map(() => raw("Password")) };
      await startHost();
      userInput();
      await edit({ name: "draft", password: "new-secret" });
      flushAutosave();
      expect(readEditorDraft(editScope)?.changedRedactedPaths).toEqual(["/password"]);
      expect(JSON.stringify(readEditorDraft(editScope))).not.toContain("new-secret");
      wrapper?.unmount();

      Object.assign(form, { name: "saved", password: "stored" });
      const again = await mountHost();
      const started = again.start();
      await flushPromises();
      expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
        "Your change to the Password was not kept. Re-enter it before saving.",
      );
      again.chooseRestore("continue");
      await started;

      expect(form).toMatchObject({ name: "draft", password: "" });
      expect(apply).toHaveBeenLastCalledWith(expect.anything(), {
        notKeptPaths: ["/password"],
      });
      expect(again.pendingReentries()).toEqual(["/password"]);
      await edit({ password: "typed again" });
      expect(again.pendingReentries()).toEqual([]);
    });

    it("keeps a not-kept secret not kept across a second Continue while it is still blank", async () => {
      overrides = { describeRedacted: (paths) => paths.map(() => raw("Password")) };
      form.password = "stored";
      seed(
        editScope,
        { name: "draft", password: "" },
        { redactedPaths: ["/password"], changedRedactedPaths: ["/password"] },
      );
      const first = await mountHost();
      const started = first.start();
      await flushPromises();
      first.chooseRestore("continue");
      await started;
      expect(form.password).toBe("");

      userInput();
      await edit({ name: "edited after continue" });
      flushAutosave();
      expect(readEditorDraft(editScope)?.changedRedactedPaths).toEqual(["/password"]);
      wrapper?.unmount();

      Object.assign(form, { name: "saved", password: "stored" });
      const second = await mountHost();
      const restarted = second.start();
      await flushPromises();
      expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
        "Your change to the Password was not kept.",
      );
      second.chooseRestore("continue");
      await restarted;
      expect(form).toMatchObject({ name: "edited after continue", password: "" });
      expect(second.pendingReentries()).toEqual(["/password"]);

      userInput();
      await edit({ password: "typed again" });
      flushAutosave();
      expect(readEditorDraft(editScope)?.changedRedactedPaths).toEqual(["/password"]);
      expect(second.pendingReentries()).toEqual([]);
    });

    it("treats every secret of a draft written before changes were tracked as changed", async () => {
      form.password = "stored";
      seed(editScope, { name: "draft", password: "" }, { redactedPaths: ["/password"] });
      const draft = await mountHost();
      const started = draft.start();
      await flushPromises();
      expect(draft.state.credentialsNotSaved).toBe(true);
      draft.chooseRestore("continue");
      await started;
      expect(form.password).toBe("");
    });

    it("stores a base hash over the base with its secrets blanked, and still sees a server change", async () => {
      server = { name: "saved", password: "s3cret", tab: "a" };
      await startHost();
      userInput();
      await edit({ name: "typed" });
      flushAutosave();
      const stored = readEditorDraft(editScope)?.baseHash;
      expect(stored).toBe(hashDraftValue({ name: "saved", password: "", tab: "a" }));
      expect(stored).not.toBe(hashDraftValue(server));
      wrapper?.unmount();

      server = { name: "renamed on server", password: "s3cret", tab: "a" };
      const again = await mountHost();
      const started = again.start();
      await flushPromises();
      expect(again.state.changedOnServer).toBe(true);
      again.chooseRestore("dismiss");
      await started;
    });

    it("blanks secrets of the base through redactBase before hashing", async () => {
      overrides = {
        redactBase: (base) => ({ ...(base as Form), tab: "" }),
      };
      server = { name: "saved", password: "", tab: "hidden-material" };
      await startHost();
      userInput();
      await edit({ name: "typed" });
      flushAutosave();
      expect(readEditorDraft(editScope)?.baseHash).toBe(
        hashDraftValue({ name: "saved", password: "", tab: "" }),
      );
    });

    it("words the dialogs for an item with a server-side draft, and takes a Save label", async () => {
      overrides = { serverDraftItem: true, saveLabel: () => raw("Publish") };
      seed(editScope, { name: "draft" });
      const draft = await mountHost();
      const started = draft.start();
      await flushPromises();
      expect(byTest("editor-draft-continue")?.textContent).toContain("Continue editing");
      draft.chooseRestore("dismiss");
      await started;

      userInput();
      await edit({ name: "typed" });
      const result = leave();
      await flushPromises();
      expect(leaveDialogButton("o-dialog-secondary-btn")?.textContent).toContain(
        "Keep in this browser",
      );
      expect(leaveDialogButton("editor-draft-leave-save")?.textContent).toContain("Publish");
      expect(byTest("editor-draft-leave-message")?.textContent).toContain(
        "keep your changes in this browser until you sign out",
      );
      expect(byTest("editor-draft-leave-message")?.textContent).not.toContain("draft");
      draft.chooseLeave("stay");
      expect(await result).toBe(false);
    });

    it("warns when the server item changed after the draft was written", async () => {
      seed(editScope, { name: "draft" }, { baseHash: hashDraftValue({ old: true }) });
      const draft = await mountHost();
      const started = draft.start();
      await flushPromises();

      expect(draft.state.changedOnServer).toBe(true);
      expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
      draft.chooseRestore("dismiss");
      await started;
    });

    it("does not warn when the server item is unchanged", async () => {
      seed(editScope, { name: "draft" }, { baseHash: hashDraftValue(server) });
      const draft = await mountHost();
      const started = draft.start();
      await flushPromises();
      expect(draft.state.changedOnServer).toBe(false);
      draft.chooseRestore("fresh");
      await started;
    });

    it("start fresh deletes the draft and keeps the saved item", async () => {
      seed(editScope, { name: "draft" });
      const draft = await mountHost();
      const started = draft.start();
      await flushPromises();
      draft.chooseRestore("fresh");
      await started;

      expect(readEditorDraft(editScope)).toBeNull();
      expect(apply).not.toHaveBeenCalled();
      expect(form.name).toBe("saved");
    });

    it("escape keeps the draft until the first edit, then autosave saves this session's work", async () => {
      seed(editScope, { name: "kept" });
      const draft = await mountHost();
      const started = draft.start();
      await flushPromises();
      draft.chooseRestore("dismiss");
      await started;

      userInput();
      flushAutosave();
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("kept");

      await edit({ name: "new work" });
      flushAutosave();
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("new work");
      await edit({ name: "more work" });
      flushAutosave();
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("more work");
    });

    it("an edit undone after escape puts the kept draft back as it was", async () => {
      seed(editScope, { name: "kept" });
      const keptAt = readEditorDraft(editScope)!.savedAt;
      const draft = await mountHost();
      const started = draft.start();
      await flushPromises();
      draft.chooseRestore("dismiss");
      await started;

      userInput();
      await edit({ name: "new work" });
      flushAutosave();
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("new work");
      await edit({ name: "saved" });
      flushAutosave();
      expect(readEditorDraft<Form>(editScope)).toMatchObject({
        savedAt: keptAt,
        data: { name: "kept" },
      });

      await edit({ name: "again" });
      flushAutosave();
      draft.discard();
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("kept");
    });

    it("discard leaves a draft kept by escape, keep draft replaces it", async () => {
      seed(editScope, { name: "kept" });
      const draft = await mountHost();
      const started = draft.start();
      await flushPromises();
      draft.chooseRestore("dismiss");
      await started;
      userInput();
      await edit({ name: "new work" });

      const discarded = leave();
      await flushPromises();
      draft.chooseLeave("discard");
      expect(await discarded).toBe(true);
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("kept");

      await edit({ name: "newer work" });
      const kept = leave();
      await flushPromises();
      draft.chooseLeave("keep");
      expect(await kept).toBe(true);
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("newer work");
    });

    it("drops the draft of a deleted item with an info toast", async () => {
      server = null;
      seed(editScope, { name: "draft" });
      const draft = await startHost();

      expect(readEditorDraft(editScope)).toBeNull();
      expect(draft.state.restoreOpen).toBe(false);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "info", message: expect.stringContaining("function") }),
      );
    });

    it("offers the new-item draft to a new item", async () => {
      entityId = null;
      server = null;
      seed(newScope, { name: "new draft" });
      const draft = await mountHost();
      const started = draft.start();
      await flushPromises();
      expect(draft.state.restoreOpen).toBe(true);
      draft.chooseRestore("continue");
      await started;
      expect(form.name).toBe("new draft");
    });

    it("uses the editor's restore title", async () => {
      overrides = { restoreTitle: () => raw("Unsaved local changes") };
      seed(editScope, { name: "draft" });
      const draft = await mountHost();
      const started = draft.start();
      await flushPromises();
      expect(body().textContent).toContain("Unsaved local changes");
      draft.chooseRestore("dismiss");
      await started;
    });
  });

  describe("leave dialog", () => {
    it("lets a clean editor leave and clears an undone draft", async () => {
      await startHost();
      userInput();
      await edit({ name: "typed" });
      flushAutosave();
      await edit({ name: "saved" });

      expect(await leave()).toBe(true);
      expect(readEditorDraft(editScope)).toBeNull();
      expect(byTest("editor-draft-leave-dialog")).toBeNull();
    });

    it("hands the open dialog to a second navigation and refuses the first", async () => {
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });

      const first = leave();
      await flushPromises();
      expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
      const second = leave();
      expect(await first).toBe(false);
      await flushPromises();
      expect(draft.state.leaveOpen).toBe(true);
      expect(byTest("editor-draft-leave-dialog")).not.toBeNull();

      draft.chooseLeave("discard");
      expect(await second).toBe(true);
      expect(draft.state.leaveOpen).toBe(false);
      expect(draft.hasUnsavedChanges()).toBe(false);
    });

    it("blocks a navigation while the leave dialog's save runs, and stays usable after it fails", async () => {
      let settle!: (saved: boolean) => void;
      save.mockReturnValue(new Promise<boolean>((resolve) => (settle = resolve)));
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });

      const first = leave();
      await flushPromises();
      draft.chooseLeave("save");
      await flushPromises();
      expect(await leave()).toBe(false);
      settle(false);
      expect(await first).toBe(false);

      const again = leave();
      await flushPromises();
      expect(draft.state.leaveOpen).toBe(true);
      draft.chooseLeave("discard");
      expect(await again).toBe(true);
    });

    it("discard deletes the draft and leaves", async () => {
      await startHost();
      userInput();
      await edit({ name: "typed" });
      flushAutosave();

      const result = leave();
      await flushPromises();
      leaveDialogButton("o-dialog-neutral-btn")?.click();
      expect(await result).toBe(true);
      expect(readEditorDraft(editScope)).toBeNull();
    });

    it("keep draft writes it now and leaves", async () => {
      await startHost();
      userInput();
      await edit({ name: "typed" });

      const result = leave();
      await flushPromises();
      leaveDialogButton("o-dialog-secondary-btn")?.click();
      expect(await result).toBe(true);
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("typed");
    });

    it("stays with an error toast when keep draft cannot be stored", async () => {
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });

      const result = leave();
      await flushPromises();
      draft.chooseLeave("keep");
      expect(await result).toBe(false);
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
      vi.restoreAllMocks();
    });

    it("save runs the editor's save and leaves on success", async () => {
      save.mockResolvedValue(true);
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      flushAutosave();

      const result = leave();
      await flushPromises();
      leaveDialogButton("editor-draft-leave-save")?.click();
      expect(await result).toBe(true);
      expect(save).toHaveBeenCalledTimes(1);
      expect(readEditorDraft(editScope)).toBeNull();
      expect(draft.hasUnsavedChanges()).toBe(false);
    });

    it("save keeps the user in the editor when it fails", async () => {
      let settle!: (saved: boolean) => void;
      save.mockReturnValue(new Promise<boolean>((resolve) => (settle = resolve)));
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });

      const result = leave();
      await flushPromises();
      draft.chooseLeave("save");
      await flushPromises();
      expect(draft.state.leaveSaving).toBe(true);
      expect(draft.state.leaveOpen).toBe(true);
      draft.chooseLeave("stay");
      expect(draft.state.leaveOpen).toBe(true);
      settle(false);
      expect(await result).toBe(false);
      expect(draft.state.leaveOpen).toBe(false);
      expect(draft.hasUnsavedChanges()).toBe(true);
    });

    it("guards the editor's own buttons through confirmLeave", async () => {
      const draft = await startHost();
      expect(await draft.confirmLeave()).toBe(true);

      userInput();
      await edit({ name: "typed" });
      const result = draft.confirmLeave();
      await flushPromises();
      draft.chooseLeave("discard");
      expect(await result).toBe(true);
      expect(await leave()).toBe(true);
    });

    it("hides keep draft when storage is unavailable", async () => {
      vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      const draft = await startHost();
      vi.restoreAllMocks();
      expect(draft.storageAvailable).toBe(false);
      userInput();
      await edit({ name: "typed" });
      const result = leave();
      await flushPromises();
      expect(leaveDialogButton("o-dialog-secondary-btn")).toBeNull();
      draft.chooseLeave("stay");
      expect(await result).toBe(false);
    });

    it("guards a route update only when it leaves the item", async () => {
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      expect(await updateGuard()({ path: "/editor" }, { path: "/editor" })).toBe(true);

      const result = updateGuard()({ path: "/editor/2" }, { path: "/editor/1" });
      await flushPromises();
      expect(draft.state.leaveOpen).toBe(true);
      draft.chooseLeave("stay");
      expect(await result).toBe(false);
    });

    it("uses the editor's route-update rule", async () => {
      overrides = { leaveOnRouteUpdate: () => false };
      await startHost();
      userInput();
      await edit({ name: "typed" });
      expect(await updateGuard()({ path: "/editor/2" }, { path: "/editor/1" })).toBe(true);
    });
  });

  describe("signing out", () => {
    afterEach(() => resumeEditorDraftSession());

    it("offers only Save or Discard with the sign-out note, and writes nothing after the clear", async () => {
      vi.useFakeTimers();
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      endEditorDraftSession();

      const result = leave();
      await flushPromises();
      expect(draft.state.canKeepDraft).toBe(false);
      expect(leaveDialogButton("o-dialog-secondary-btn")).toBeNull();
      expect(byTest("editor-draft-leave-sign-out")).not.toBeNull();
      leaveDialogButton("o-dialog-neutral-btn")?.click();
      expect(await result).toBe(true);

      await edit({ name: "after sign-out" });
      flushAutosave();
      vi.advanceTimersByTime(2000);
      wrapper?.unmount();
      wrapper = null;
      expect(readEditorDraft(editScope)).toBeNull();
    });

    it("while a sign-out runs the guards, offers Save or Discard and lets the redirect to login pass", async () => {
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      beginDraftSignOut();
      try {
        const first = leaveGuard()({ path: "/logout" }, { path: "/editor" });
        await flushPromises();
        expect(draft.state.canKeepDraft).toBe(false);
        expect(byTest("editor-draft-leave-message")?.textContent).toContain(
          "Save the function or discard your changes.",
        );
        leaveDialogButton("o-dialog-neutral-btn")?.click();
        expect(await first).toBe(true);
        endEditorDraftSession();

        expect(await leaveGuard()({ path: "/login" }, { path: "/editor" })).toBe(true);
        expect(byTest("editor-draft-leave-dialog")).toBeNull();
      } finally {
        cancelDraftSignOut();
      }
    });

    it("offers only Discard when the sign-out's session cannot save, and ignores a Save", async () => {
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      beginDraftSignOut({ discardOnly: true });
      try {
        const result = leaveGuard()({ path: "/logout" }, { path: "/editor" });
        await flushPromises();
        expect(draft.state.canSave).toBe(false);
        expect(leaveDialogButton("editor-draft-leave-save")).toBeNull();
        expect(byTest("editor-draft-leave-message")?.textContent).toContain(
          "cannot be saved until you sign in again",
        );
        draft.chooseLeave("save");
        expect(save).not.toHaveBeenCalled();
        expect(draft.state.leaveSaving).toBe(false);
        leaveDialogButton("o-dialog-neutral-btn")?.click();
        expect(await result).toBe(true);
      } finally {
        cancelDraftSignOut();
      }
    });

    it("writes nothing on unload or unmount when the dialog is closed after sign-out", async () => {
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      endEditorDraftSession();
      const result = leave();
      await flushPromises();
      draft.chooseLeave("stay");
      expect(await result).toBe(false);

      flushAutosave();
      await edit({ name: "more" });
      wrapper?.unmount();
      wrapper = null;
      expect(readEditorDraft(editScope)).toBeNull();
    });
  });

  describe("baseline from focus or inserted text", () => {
    it("takes the baseline when a field in the editor gets focus, so text inserted without keys counts", async () => {
      const draft = await startHost();
      (byTest("host-field") as HTMLElement).dispatchEvent(
        new FocusEvent("focusin", { bubbles: true }),
      );
      await edit({ name: "autofilled" });
      expect(draft.hasUnsavedChanges()).toBe(true);
      flushAutosave();
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("autofilled");
    });

    it("takes the baseline on beforeinput too", async () => {
      const draft = await startHost();
      (byTest("host-field") as HTMLElement).dispatchEvent(
        new InputEvent("beforeinput", { bubbles: true }),
      );
      await edit({ name: "dictated" });
      expect(draft.hasUnsavedChanges()).toBe(true);
    });

    it("ignores focus outside the editor and on hidden controls", async () => {
      const draft = await startHost();
      const outside = document.createElement("input");
      document.body.appendChild(outside);
      outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      outside.remove();
      (byTest("host-hidden-select") as HTMLElement).dispatchEvent(
        new FocusEvent("focusin", { bubbles: true }),
      );
      await edit({ name: "loaded later" });
      expect(draft.hasUnsavedChanges()).toBe(false);
    });
  });

  describe("fields in a teleported drawer, or in extra input roots", () => {
    const mountDrawerHost = async (extra: Partial<UseEditorDraftOptions<Form>> = {}) => {
      let draft!: EditorDraftController;
      const DrawerHost = defineComponent({
        setup() {
          draft = useEditorDraft<Form>({
            kind: "function",
            entityLabel: () => raw("function"),
            entityId: () => entityId,
            snapshot: () => ({ ...form }),
            apply,
            base: () => server,
            save,
            ...extra,
          });
          return () =>
            h("div", [
              h(
                ODrawer,
                { open: true, title: raw("Settings") },
                { default: () => h("input", { "data-test": "drawer-field" }) },
              ),
            ]);
        },
      });
      wrapper = mount(DrawerHost, { attachTo: document.body, global: { plugins: [store] } });
      await flushPromises();
      return draft;
    };

    it("takes the baseline on focus of a field inside a teleported ODrawer", async () => {
      const draft = await mountDrawerHost();
      await draft.start();
      const field = byTest("drawer-field") as HTMLInputElement;
      expect(wrapper!.element.contains(field)).toBe(false);
      field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await edit({ name: "typed in the drawer" });
      expect(draft.hasUnsavedChanges()).toBe(true);
    });

    it("counts an edit made in the drawer while the item loads", async () => {
      const draft = await mountDrawerHost();
      const field = byTest("drawer-field") as HTMLInputElement;
      field.value = "early";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await draft.start();
      expect(draft.hasUnsavedChanges()).toBe(true);
    });

    it("treats fields under inputRoots as the editor's", async () => {
      const outside = document.createElement("div");
      outside.innerHTML = '<input data-test="outside-field" />';
      document.body.appendChild(outside);
      try {
        overrides = { inputRoots: () => [outside, null] };
        const draft = await startHost();
        (byTest("outside-field") as HTMLElement).dispatchEvent(
          new FocusEvent("focusin", { bubbles: true }),
        );
        await edit({ name: "typed outside" });
        expect(draft.hasUnsavedChanges()).toBe(true);
      } finally {
        outside.remove();
      }
    });
  });

  describe("secretExemptKeys", () => {
    it("keeps a non-secret field whose key matches the secret pattern", async () => {
      type Auth = { authApiKeyHeaderName: string; authApiKeyToken: string };
      const auth = reactive<Auth>({ authApiKeyHeaderName: "", authApiKeyToken: "" });
      let draft!: EditorDraftController;
      const Host = defineComponent({
        setup() {
          draft = useEditorDraft<Auth>({
            kind: "function",
            entityLabel: () => raw("function"),
            entityId: () => null,
            snapshot: () => ({ ...auth }),
            apply: (data) => Object.assign(auth, data),
            save: async () => true,
            secretExemptKeys: ["authApiKeyHeaderName"],
          });
          return () => h(EditorDraftDialogs, { draft });
        },
      });
      wrapper = mount(Host, { attachTo: document.body, global: { plugins: [store] } });
      await draft.start();
      userInput();
      Object.assign(auth, { authApiKeyHeaderName: "X-Judge-Key", authApiKeyToken: "secret" });
      await nextTick();
      flushAutosave();
      expect(readEditorDraft<Auth>(newScope)?.data).toEqual({
        authApiKeyHeaderName: "X-Judge-Key",
        authApiKeyToken: "",
      });
    });
  });

  describe("edits before start", () => {
    const hostField = () => byTest("host-field") as HTMLInputElement;
    const typeInto = (field: HTMLInputElement, value: string) => {
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };

    it("counts an edit made inside the editor while the item loads as unsaved", async () => {
      const draft = await mountHost();
      typeInto(hostField(), "typed while loading");
      await edit({ name: "typed while loading" });
      await draft.start();

      expect(draft.hasUnsavedChanges()).toBe(true);
      const result = leave();
      await flushPromises();
      expect(draft.state.leaveOpen).toBe(true);
      draft.chooseLeave("keep");
      expect(await result).toBe(true);
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("typed while loading");
    });

    it("counts an edit inside an OPageLayout root, whose dev build renders a fragment", async () => {
      let draft!: EditorDraftController;
      const PageHost = defineComponent({
        setup() {
          draft = useEditorDraft<Form>({
            kind: "function",
            entityLabel: () => raw("function"),
            entityId: () => entityId,
            snapshot: () => ({ ...form }),
            apply,
            base: () => server,
            save,
          });
          return () =>
            h(
              OPageLayout,
              { title: raw("Edit function") },
              { default: () => h("input", { "data-test": "page-field" }) },
            );
        },
      });
      wrapper = mount(PageHost, { attachTo: document.body, global: { plugins: [store] } });
      await nextTick();
      typeInto(byTest("page-field") as HTMLInputElement, "typed in the page");
      await draft.start();
      expect(draft.hasUnsavedChanges()).toBe(true);
    });

    it("ignores an edit the load then overwrote", async () => {
      const draft = await mountHost();
      typeInto(hostField(), "typed early");
      hostField().value = "loaded from the server";
      await draft.start();
      expect(draft.hasUnsavedChanges()).toBe(false);
    });

    it("ignores input outside the editor and keys that change nothing", async () => {
      const draft = await mountHost();
      const outside = document.createElement("input");
      document.body.appendChild(outside);
      typeInto(outside, "chat message");
      outside.remove();
      hostField().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      hostField().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await draft.start();
      expect(draft.hasUnsavedChanges()).toBe(false);
    });

    it("ignores a change on a hidden native control that code set while loading", async () => {
      const draft = await mountHost();
      const hidden = byTest("host-hidden-select") as HTMLSelectElement;
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
      hidden.dispatchEvent(new Event("input", { bubbles: true }));
      await edit({ name: "loaded" });
      await draft.start();
      expect(draft.hasUnsavedChanges()).toBe(false);
      flushAutosave();
      expect(readEditorDraft(editScope)).toBeNull();
    });

    it("stops counting once the editor is rebaselined", async () => {
      const draft = await mountHost();
      typeInto(hostField(), "typed");
      await draft.start();
      draft.discard();
      expect(draft.hasUnsavedChanges()).toBe(false);
    });
  });

  describe("forced sign-out", () => {
    it("treats closing the leave dialog as Discard, so the sign-out goes on", async () => {
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      flushAutosave();
      beginDraftSignOut({ forced: true });
      try {
        const result = leaveGuard()({ path: "/logout" }, { path: "/editor" });
        await flushPromises();
        expect(leaveDialogButton("editor-draft-leave-save")).toBeNull();
        expect(leaveDialogButton("o-dialog-secondary-btn")).toBeNull();
        draft.chooseLeave("stay");
        expect(await result).toBe(true);
        expect(readEditorDraft(editScope)).toBeNull();
      } finally {
        cancelDraftSignOut();
      }
    });
  });

  describe("contentOf and rebaselineOnInputAfterDiscard", () => {
    it("counts only the content as a change, while the whole snapshot is drafted", async () => {
      overrides = { contentOf: ({ tab: _tab, ...rest }) => rest };
      const draft = await startHost();
      userInput();
      await edit({ tab: "b" });
      expect(draft.hasUnsavedChanges()).toBe(false);
      await edit({ name: "typed" });
      expect(draft.hasUnsavedChanges()).toBe(true);
      flushAutosave();
      expect(readEditorDraft<Form>(editScope)?.data).toMatchObject({ name: "typed", tab: "b" });
    });

    it("after a discard, a load landing before the next input is not an edit", async () => {
      overrides = { rebaselineOnInputAfterDiscard: true };
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      const result = leave();
      await flushPromises();
      draft.chooseLeave("discard");
      expect(await result).toBe(true);

      await edit({ name: "late load" });
      userInput();
      expect(draft.hasUnsavedChanges()).toBe(false);
      await edit({ name: "real edit" });
      expect(draft.hasUnsavedChanges()).toBe(true);
    });

    it("runs onLeaveWithoutSave on Discard and on Keep, but not on Stay", async () => {
      const onLeaveWithoutSave = vi.fn();
      overrides = { onLeaveWithoutSave };
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      const stay = leave();
      await flushPromises();
      draft.chooseLeave("stay");
      expect(await stay).toBe(false);
      expect(onLeaveWithoutSave).not.toHaveBeenCalled();

      const discard = leave();
      await flushPromises();
      draft.chooseLeave("discard");
      expect(await discard).toBe(true);
      expect(onLeaveWithoutSave).toHaveBeenCalledTimes(1);
    });
  });

  describe("base hash", () => {
    it("is taken after the secret lists and the editor's base redaction", async () => {
      const base = { name: "saved", password: "", tab: "a", headers: [{ key: "X", value: "v1" }] };
      overrides = {
        base: () => base,
        secretLists: ["/headers"],
        redactBase: (value) => ({ ...(value as typeof base), tab: "" }),
      };
      await startHost();
      userInput();
      await edit({ name: "typed" });
      flushAutosave();
      expect(readEditorDraft(editScope)?.baseHash).toBe(
        hashDraftValue({ ...base, tab: "", headers: [{ key: "X", value: "" }] }),
      );
    });
  });

  describe("secretLists", () => {
    it("blanks every value of a listed list whatever its name, and restores it by label", async () => {
      type Req = { headers: { key: string; value: string }[] };
      const req = reactive<Req>({
        headers: [
          { key: "X-Honeycomb-Team", value: "sid=1" },
          { key: "X-Team", value: "core" },
        ],
      });
      let host!: EditorDraftController;
      const Host = defineComponent({
        setup() {
          host = useEditorDraft<Req>({
            kind: "function",
            entityLabel: () => raw("function"),
            entityId: () => "fn1",
            snapshot: () => JSON.parse(JSON.stringify(req)) as Req,
            apply: (data) => Object.assign(req, data),
            base: () => ({ saved: true }),
            save: async () => true,
            secretLists: ["/headers"],
          });
          return () => h(EditorDraftDialogs, { draft: host });
        },
      });
      wrapper = mount(Host, { attachTo: document.body, global: { plugins: [store] } });
      await host.start();
      userInput();
      req.headers = [...req.headers.reverse()];
      await nextTick();
      flushAutosave();
      const stored = readEditorDraft<Req>(editScope);
      expect(JSON.stringify(stored)).not.toContain("sid=1");
      expect(JSON.stringify(stored)).not.toContain("core");
      expect(stored?.redactedPaths).toEqual(["/headers/0/value", "/headers/1/value"]);
      expect(stored?.changedRedactedPaths).toEqual([]);
      wrapper.unmount();

      req.headers = [
        { key: "X-Honeycomb-Team", value: "sid=1" },
        { key: "X-Team", value: "core" },
      ];
      wrapper = mount(Host, { attachTo: document.body, global: { plugins: [store] } });
      const started = host.start();
      await flushPromises();
      host.chooseRestore("continue");
      await started;
      expect(req.headers).toEqual([
        { key: "X-Team", value: "core" },
        { key: "X-Honeycomb-Team", value: "sid=1" },
      ]);
    });
  });

  describe("keepAndRelease", () => {
    it("writes the work as a draft without asking and lets the editor go", async () => {
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });

      expect(draft.keepAndRelease()).toBe(true);
      expect(byTest("editor-draft-leave-dialog")).toBeNull();
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("typed");
      expect(draft.hasUnsavedChanges()).toBe(false);
      expect(await leave()).toBe(true);
    });

    it("replaces a draft kept by Escape", async () => {
      seed(editScope, { name: "older" });
      const draft = await mountHost();
      const started = draft.start();
      await flushPromises();
      draft.chooseRestore("dismiss");
      await started;
      userInput();
      await edit({ name: "newer" });

      expect(draft.keepAndRelease()).toBe(true);
      expect(readEditorDraft<Form>(editScope)?.data.name).toBe("newer");
    });

    it("returns false with an error toast when the draft cannot be stored", async () => {
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });

      expect(draft.keepAndRelease()).toBe(false);
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
      vi.restoreAllMocks();
      expect(draft.hasUnsavedChanges()).toBe(true);
    });

    it("writes nothing for a clean editor", async () => {
      const draft = await startHost();
      expect(draft.keepAndRelease()).toBe(true);
      expect(readEditorDraft(editScope)).toBeNull();
    });
  });

  describe("new-item variants", () => {
    it("keeps each variant's new-item draft in its own slot", async () => {
      entityId = null;
      server = null;
      let variant = "http";
      overrides = { newVariant: () => variant };
      seed(newScope, { name: "plain" });
      seed({ ...newScope, variant: "tcp" }, { name: "tcp draft" });

      await startHost();
      expect(byTest("editor-draft-restore-dialog")).toBeNull();
      userInput();
      await edit({ name: "http work" });
      flushAutosave();
      expect(readEditorDraft<Form>({ ...newScope, variant: "http" })?.data.name).toBe("http work");
      expect(readEditorDraft<Form>(newScope)?.data.name).toBe("plain");
      wrapper?.unmount();

      variant = "tcp";
      const tcp = await mountHost();
      const started = tcp.start();
      await flushPromises();
      tcp.chooseRestore("continue");
      await started;
      expect(form.name).toBe("tcp draft");

      entityId = "fn7";
      tcp.markSaved();
      expect(readEditorDraft({ ...newScope, variant: "tcp" })).toBeNull();
      expect(readEditorDraft({ ...newScope, variant: "http" })).not.toBeNull();
    });
  });

  describe("markSaved and discard", () => {
    it("markSaved deletes the draft and moves a new item's drafts to its id", async () => {
      entityId = null;
      server = null;
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      flushAutosave();
      expect(readEditorDraft(newScope)).not.toBeNull();

      entityId = "fn9";
      draft.markSaved();
      expect(readEditorDraft(newScope)).toBeNull();
      expect(draft.hasUnsavedChanges()).toBe(false);

      await edit({ name: "after save" });
      flushAutosave();
      expect(readEditorDraft({ ...editScope, entityId: "fn9" })).not.toBeNull();
    });

    it("discard drops the session draft and the unsaved state", async () => {
      const draft = await startHost();
      userInput();
      await edit({ name: "typed" });
      flushAutosave();
      draft.discard();
      expect(readEditorDraft(editScope)).toBeNull();
      expect(draft.hasUnsavedChanges()).toBe(false);
    });
  });
});

describe("useEditorDraftIds", () => {
  beforeEach(() => localStorage.clear());

  it("tracks the current user's drafts of one kind as they change", async () => {
    const localStore = createStore({
      state: { selectedOrganization: { identifier: "org1" }, userInfo: { email: "me@x.io" } },
    });
    let ids!: EditorDraftIds;
    const Host = defineComponent({
      setup() {
        ids = useEditorDraftIds("function");
        return () => h("div", [...ids.ids].join(","));
      },
    });
    const host = mount(Host, { global: { plugins: [localStore] } });

    expect(ids.hasNew).toBe(false);
    seed(editScope, {});
    seed(newScope, {});
    seed({ ...editScope, kind: "alert", entityId: "a1" }, {});
    seed({ ...editScope, userEmail: "other@x.io", entityId: "fn2" }, {});
    seed({ ...newScope, variant: "tcp" }, {});
    await nextTick();

    expect([...ids.ids]).toEqual(["fn1"]);
    expect(ids.hasNew).toBe(true);
    expect(ids.hasNewVariant("tcp")).toBe(true);
    expect(ids.hasNewVariant("http")).toBe(false);
    expect(ids.savedAtVariant("tcp")).toBe(
      readEditorDraft({ ...newScope, variant: "tcp" })?.savedAt,
    );
    expect(ids.savedAtVariant("http")).toBeNull();
    expect(ids.savedAt(null)).toBe(readEditorDraft(newScope)?.savedAt);
    expect(ids.savedAt("fn1")).toBe(readEditorDraft(editScope)?.savedAt);
    expect(ids.savedAt("missing")).toBeNull();
    expect(host.text()).toBe("fn1");

    deleteEditorDraft(editScope);
    deleteEditorDraft(newScope);
    await nextTick();
    expect(host.text()).toBe("");
    expect(ids.hasNew).toBe(false);
    expect(ids.hasNewVariant("tcp")).toBe(true);
    host.unmount();
  });
});
