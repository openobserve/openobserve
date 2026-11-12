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
import { h } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { fillField } from "@/test/unit/helpers/fillField";
import { queryClient } from "@/composables/query/queryClient";
import regexPatternService from "@/services/regex_pattern";
import {
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { byTest, click, clickIn, clickLeave, clickRestore } from "@/test/unit/helpers/draftDom";
import RegexPatternList from "./RegexPatternList.vue";
import AddRegexPattern from "./AddRegexPattern.vue";

vi.mock("@/services/regex_pattern", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      bulkDelete: vi.fn(),
      test: vi.fn(),
    },
  });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));

const service = regexPatternService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const newScope: EditorDraftScope = {
  kind: "regex_pattern",
  org: "default",
  entityId: null,
  userEmail: "example@gmail.com",
};
const ssnId = "7378809949452783616";
const editScope: EditorDraftScope = { ...newScope, entityId: ssnId };

const ssn = {
  id: ssnId,
  name: "American Social Security Number",
  pattern: "\\b\\d{3}[-\\s]?\\d{2}[-\\s]?\\d{4}\\b",
  description: "An American identification number",
  created_at: 1759245383609043,
  updated_at: 1759254260673538,
};
const nginx = {
  id: "7363029241765576704",
  name: "nginx_parser",
  pattern: "(?P<remote_addr>\\S+) - (?P<remote_user>\\S+)",
  description: "",
  created_at: 1755482969705767,
  updated_at: 1755482969705767,
};

const draftData = (patch: Record<string, string> = {}) => ({
  name: "email format",
  pattern: "^[\\w.-]+@[\\w.-]+\\.\\w{2,}$",
  description: "",
  testString: "root@openobserve.ai",
  ...patch,
});

let router: Router;
let wrapper: VueWrapper | null = null;

const mountPage = async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/settings/regex_patterns", name: "regexPatterns", component: RegexPatternList },
      { path: "/logs", name: "logs", component: { render: () => h("div") } },
    ],
  });
  await router.push({ name: "regexPatterns" });
  wrapper = mount(
    { render: () => h(RouterView) },
    { attachTo: document.body, global: { plugins: [i18n, store, router] } },
  );
  await flushPromises();
};

interface ListVm {
  createRegexPattern: () => void;
  editRegexPattern: (row: unknown) => void;
  confirmDeleteRegexPattern: (row: unknown) => void;
  deleteRegexPattern: () => Promise<void>;
  handleSelectedIdsUpdate: (ids: string[]) => void;
  bulkDeleteRegexPatterns: () => Promise<void>;
  showAddRegexPatternDialog: { show: boolean };
}

const list = () => wrapper!.findComponent(RegexPatternList).vm as unknown as ListVm;
const drawerOpen = () => list().showAddRegexPatternDialog.show;
const regexForm = () =>
  (
    wrapper!.findComponent(AddRegexPattern).vm as unknown as {
      addRegexPatternForm: { form: { state: { values: Record<string, string> } } };
    }
  ).addRegexPatternForm.form;

const openNew = async () => {
  list().createRegexPattern();
  await flushPromises();
};
const openEdit = async () => {
  list().editRegexPattern(ssn);
  await flushPromises();
};

// A click into the field, then typed text: the path every user takes, apart from autofill.
const clickAndType = async (dataTest: string, value: string) => {
  window.dispatchEvent(new Event("pointerdown"));
  await fillField(dataTest, value);
};

describe("AddRegexPattern drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    vi.clearAllMocks();
    service.list.mockResolvedValue({ data: { patterns: [ssn, nginx] } });
    service.create.mockResolvedValue({ status: 200, data: {} });
    service.update.mockResolvedValue({ status: 200, data: {} });
    service.delete.mockResolvedValue({ data: {} });
    service.bulkDelete.mockResolvedValue({ data: { successful: [ssnId], unsuccessful: [] } });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("drafts a pattern filled into the drawer", async () => {
    await mountPage();
    await openNew();
    await fillField("add-regex-pattern-name-input", "email format");
    await fillField("add-regex-pattern-input", "^[\\w.-]+@[\\w.-]+$");
    window.dispatchEvent(new Event("pagehide"));

    expect(readEditorDraft(newScope)?.data).toEqual({
      name: "email format",
      pattern: "^[\\w.-]+@[\\w.-]+$",
      description: "",
      testString: "",
    });
  });

  it("offers the draft when the drawer opens, and Continue fills the form", async () => {
    writeEditorDraft(newScope, { data: draftData() });
    await mountPage();
    await openNew();

    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain("regex pattern");
    click("editor-draft-continue");
    await flushPromises();

    expect(regexForm().state.values).toMatchObject(draftData());
  });

  it("Start fresh drops the draft", async () => {
    writeEditorDraft(newScope, { data: draftData() });
    await mountPage();
    await openNew();

    clickRestore("o-dialog-secondary-btn");
    await flushPromises();

    expect(regexForm().state.values.name).toBe("");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Escape on the restore dialog keeps the draft and the drawer", async () => {
    writeEditorDraft(newScope, { data: draftData() });
    await mountPage();
    await openNew();

    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();

    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(drawerOpen()).toBe(true);
    expect(regexForm().state.values.name).toBe("");
    expect(readEditorDraft(newScope)).not.toBeNull();
  });

  it("an edited pattern's draft is keyed by its id and keeps its locked name", async () => {
    await mountPage();
    await openEdit();
    await clickAndType("add-regex-pattern-input", "\\b\\d{3}-\\d{2}-\\d{4}\\b");
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<{ pattern: string; name: string }>(editScope);
    expect(draft?.data).toMatchObject({
      name: ssn.name,
      pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b",
    });
    expect(draft?.baseHash).toBe(
      hashDraftValue({ name: ssn.name, pattern: ssn.pattern, description: ssn.description }),
    );
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Cancel asks, and Discard closes the drawer and drops the draft", async () => {
    await mountPage();
    await openNew();
    await clickAndType("add-regex-pattern-name-input", "not_kept");
    window.dispatchEvent(new Event("pagehide"));

    clickIn("regex-pattern-list-add-regex-pattern-drawer", "o-drawer-secondary-btn");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    expect(drawerOpen()).toBe(true);

    clickLeave("o-dialog-neutral-btn");
    await flushPromises();
    expect(drawerOpen()).toBe(false);
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("the close button asks too, and Keep draft closes the drawer with the work kept", async () => {
    await mountPage();
    await openNew();
    await clickAndType("add-regex-pattern-name-input", "kept_for_later");

    clickIn("regex-pattern-list-add-regex-pattern-drawer", "o-drawer-close-btn");
    await flushPromises();
    expect(drawerOpen()).toBe(true);
    clickLeave("o-dialog-secondary-btn");
    await flushPromises();

    expect(drawerOpen()).toBe(false);
    expect(readEditorDraft<{ name: string }>(newScope)?.data.name).toBe("kept_for_later");
  });

  it("a clean drawer closes without asking", async () => {
    await mountPage();
    await openNew();

    clickIn("regex-pattern-list-add-regex-pattern-drawer", "o-drawer-close-btn");
    await flushPromises();

    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(drawerOpen()).toBe(false);
  });

  it("Save in the leave dialog saves without closing the drawer itself", async () => {
    await mountPage();
    await openNew();
    await clickAndType("add-regex-pattern-name-input", "saved_from_leave");
    await clickAndType("add-regex-pattern-input", "\\d+");

    clickIn("regex-pattern-list-add-regex-pattern-drawer", "o-drawer-secondary-btn");
    await flushPromises();
    clickLeave("editor-draft-leave-save");
    await vi.waitFor(() => expect(service.create).toHaveBeenCalledTimes(1));
    await flushPromises();

    expect(drawerOpen()).toBe(false);
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("leaving the page with the drawer open asks first", async () => {
    await mountPage();
    await openNew();
    await clickAndType("add-regex-pattern-name-input", "half_done");

    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-secondary-btn");
    await navigation;

    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft<{ name: string }>(newScope)?.data.name).toBe("half_done");
  });

  it("a normal save drops the draft and closes the drawer", async () => {
    await mountPage();
    await openEdit();
    await clickAndType("add-regex-pattern-input", "\\d{9}");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(editScope)).not.toBeNull();

    clickIn("regex-pattern-list-add-regex-pattern-drawer", "o-drawer-primary-btn");
    await vi.waitFor(() => expect(service.update).toHaveBeenCalledTimes(1));
    await flushPromises();

    expect(drawerOpen()).toBe(false);
    expect(readEditorDraft(editScope)).toBeNull();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
  });

  it("the list marks the New pattern button and the row that hold drafts", async () => {
    writeEditorDraft(newScope, { data: draftData() });
    writeEditorDraft(editScope, { data: draftData({ name: ssn.name }) });
    await mountPage();

    expect(byTest("regex-pattern-list-add-draft-dot")).not.toBeNull();
    expect(byTest("regex-pattern-list-add-pattern-btn")?.getAttribute("aria-label")).toContain(
      "unsaved draft",
    );
    await vi.waitFor(() => expect(byTest(`regex-pattern-list-${ssnId}-draft-dot`)).not.toBeNull());
    expect(byTest(`regex-pattern-list-${nginx.id}-draft-dot`)).toBeNull();
  });

  it("deleting a pattern drops its drafts, singly and in bulk", async () => {
    const nginxScope = { ...editScope, entityId: nginx.id };
    writeEditorDraft(editScope, { data: draftData() });
    writeEditorDraft(nginxScope, { data: draftData() });
    await mountPage();

    list().confirmDeleteRegexPattern(nginx);
    await list().deleteRegexPattern();
    await flushPromises();
    expect(readEditorDraft(nginxScope)).toBeNull();
    expect(readEditorDraft(editScope)).not.toBeNull();

    list().handleSelectedIdsUpdate([ssnId]);
    await list().bulkDeleteRegexPatterns();
    await flushPromises();
    expect(readEditorDraft(editScope)).toBeNull();
  });
});
