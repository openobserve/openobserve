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
import { defineComponent, h, nextTick } from "vue";
import { createStore } from "vuex";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import jsTransformService from "@/services/jstransform";
import OForm from "@/lib/forms/Form/OForm.vue";
import {
  editorDraftKey,
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { fillField } from "@/test/unit/helpers/fillField";
import AddFunction from "./AddFunction.vue";

vi.mock("@/services/jstransform", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      create: vi.fn(() => Promise.resolve({ data: { message: "created" } })),
      update: vi.fn(() => Promise.resolve({ data: { message: "updated" } })),
    },
  });
});
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "false", isCloud: "false" } }));

interface FunctionVm {
  formData: { function: string };
  handleFunctionUpdate: (code: string) => void;
  cancelAddFunction: () => Promise<void>;
  functionDraft: { hasUnsavedChanges: () => boolean };
}

const newScope: EditorDraftScope = {
  kind: "function",
  org: "test-org",
  entityId: null,
  userEmail: "me@x.io",
};
const editScope: EditorDraftScope = { ...newScope, entityId: "parse_row" };

const savedFunction = { name: "parse_row", function: ". = .", params: "row", transType: "0" };

let router: Router;
let wrapper: VueWrapper | null = null;
let editorProps: Record<string, unknown>;
const emitted: { list: unknown[]; cancel: number } = { list: [], cancel: 0 };

const store = createStore({
  state: {
    theme: "light",
    isAiChatEnabled: false,
    zoConfig: { ai_enabled: false },
    selectedOrganization: { identifier: "test-org" },
    userInfo: { email: "me@x.io" },
    timezone: "UTC",
  },
  actions: { setIsAiChatEnabled: vi.fn() },
});

const EditorRoute = defineComponent({
  setup() {
    return () =>
      h(AddFunction, {
        ...editorProps,
        "onUpdate:list": (payload: unknown) => emitted.list.push(payload),
        "onCancel:hideform": () => emitted.cancel++,
      });
  },
});

const mountEditor = async (props: Record<string, unknown> = {}, realToolbar = false) => {
  editorProps = props;
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/pipeline/functions", name: "functionList", component: EditorRoute },
      { path: "/logs", name: "logs", component: { render: () => h("div") } },
    ],
  });
  await router.push("/pipeline/functions?action=add");
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [router, store],
        provide: { store },
        stubs: {
          UnifiedQueryEditor: true,
          TestFunction: true,
          FunctionsToolbar: !realToolbar,
          FullViewContainer: true,
          O2AIChat: true,
        },
      },
    },
  );
  await flushPromises();
  return wrapper;
};

const editor = () => wrapper!.findComponent(AddFunction);
const vm = () => editor().vm as unknown as FunctionVm;
const form = () =>
  (
    editor().findComponent(OForm).vm as unknown as {
      form: { setFieldValue: (k: string, v: string) => void; handleSubmit: () => Promise<void> };
    }
  ).form;

const typeCode = async (code: string) => {
  window.dispatchEvent(new Event("pointerdown"));
  vm().handleFunctionUpdate(code);
  await nextTick();
};

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const leaveButton = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`,
  );

describe("AddFunction drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    emitted.list = [];
    emitted.cancel = 0;
    vi.mocked(jsTransformService.create).mockClear();
    vi.mocked(jsTransformService.update).mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("writes a new function's draft when the page hides", async () => {
    await mountEditor();
    form().setFieldValue("name", "my_fn");
    await typeCode(".a = 1");
    window.dispatchEvent(new Event("pagehide"));

    expect(readEditorDraft(newScope)?.data).toEqual({
      name: "my_fn",
      transType: "0",
      function: ".a = 1",
      params: "row",
    });
  });

  it("drafts and guards a new function named with no key or pointer event (autofill, fill())", async () => {
    await mountEditor({}, true);
    // A plain click event opens the name editor; it carries no pointerdown.
    byTest("add-function-name-input-trigger")?.click();
    await flushPromises();
    await fillField("add-function-name-input-input", "filled_fn");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)?.data).toMatchObject({ name: "filled_fn" });

    const pending = vm().cancelAddFunction();
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    leaveButton("o-dialog-close-btn")?.click();
    await pending;
    expect(emitted.cancel).toBe(0);
  });

  it("offers a saved draft on open and continues it", async () => {
    writeEditorDraft(newScope, {
      data: { name: "draft_fn", transType: "0", function: ".b = 2", params: "row" },
    });
    await mountEditor();

    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain(
      "unsaved changes to this function",
    );
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    expect(vm().formData.function).toBe(".b = 2");
    expect(vm().functionDraft.hasUnsavedChanges()).toBe(true);
  });

  it("keys an edited function's draft by its name and the server copy", async () => {
    await mountEditor({ modelValue: { ...savedFunction }, isUpdated: true });
    await typeCode(". = {}");
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft(editScope);
    expect(draft?.data).toMatchObject({ name: "parse_row", function: ". = {}" });
    expect(draft?.baseHash).toBe(hashDraftValue(savedFunction));
    expect(localStorage.getItem(editorDraftKey(newScope))).toBeNull();
  });

  it("edits never reach the list row, so a kept draft still asks after Continue", async () => {
    const row = { ...savedFunction };
    await mountEditor({ modelValue: row, isUpdated: true });
    await typeCode(". = {}");
    const keep = vm().cancelAddFunction();
    await flushPromises();
    leaveButton("o-dialog-secondary-btn")?.click();
    await keep;
    expect(row.function).toBe(". = .");
    wrapper!.unmount();

    await mountEditor({ modelValue: row, isUpdated: true });
    expect(byTest("editor-draft-changed-on-server")).toBeNull();
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(vm().formData.function).toBe(". = {}");

    const cancel = vm().cancelAddFunction();
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    leaveButton("o-dialog-close-btn")?.click();
    await cancel;
    expect(readEditorDraft(editScope)?.data).toMatchObject({ function: ". = {}" });
  });

  it("cancel with unsaved changes asks, and discard closes and drops the draft", async () => {
    await mountEditor();
    await typeCode(".c = 3");
    window.dispatchEvent(new Event("pagehide"));

    const pending = vm().cancelAddFunction();
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    expect(emitted.cancel).toBe(0);

    leaveButton("o-dialog-neutral-btn")?.click();
    await pending;
    expect(emitted.cancel).toBe(1);
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("save from the leave dialog saves without navigating, then closes", async () => {
    await mountEditor();
    form().setFieldValue("name", "saved_fn");
    await typeCode(".d = 4");

    const pending = vm().cancelAddFunction();
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await pending;
    await flushPromises();

    expect(jsTransformService.create).toHaveBeenCalledTimes(1);
    expect(emitted.list).toEqual([]);
    expect(emitted.cancel).toBe(1);
    expect(router.currentRoute.value.name).toBe("functionList");
  });

  it("save from the leave dialog keeps the user in the editor when the form is invalid", async () => {
    await mountEditor();
    await typeCode(".e = 5");

    const pending = vm().cancelAddFunction();
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await pending;
    await flushPromises();

    expect(jsTransformService.create).not.toHaveBeenCalled();
    expect(emitted.cancel).toBe(0);
    expect(vm().functionDraft.hasUnsavedChanges()).toBe(true);
  });

  it("guards a route leave and stays when the dialog is closed", async () => {
    await mountEditor();
    await typeCode(".f = 6");

    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    leaveButton("o-dialog-close-btn")?.click();
    await navigation;

    expect(router.currentRoute.value.name).toBe("functionList");
  });

  it("keep draft lets the route leave and keeps the work", async () => {
    await mountEditor();
    await typeCode(".g = 7");

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("o-dialog-secondary-btn")?.click();
    await navigation;

    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(newScope)?.data).toMatchObject({ function: ".g = 7" });
  });

  it("a normal save drops the draft and lets the list navigate without asking", async () => {
    await mountEditor();
    form().setFieldValue("name", "listed_fn");
    await typeCode(".h = 8");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)).not.toBeNull();

    await form().handleSubmit();
    await flushPromises();

    expect(emitted.list).toHaveLength(1);
    expect(readEditorDraft(newScope)).toBeNull();
    expect(vm().functionDraft.hasUnsavedChanges()).toBe(false);
    await router.push("/logs");
    expect(router.currentRoute.value.name).toBe("logs");
  });
});
