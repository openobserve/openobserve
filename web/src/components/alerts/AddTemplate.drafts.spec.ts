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
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import templateService from "@/services/alert_templates";
import OForm from "@/lib/forms/Form/OForm.vue";
import {
  editorDraftKey,
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { emptyContentSpec } from "./template-content/contentSpec";
import AddTemplate from "./AddTemplate.vue";

vi.mock("@/services/alert_templates", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      create: vi.fn().mockResolvedValue({ data: { code: 200 } }),
      update: vi.fn().mockResolvedValue({ data: { code: 200 } }),
    },
  });
});
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));
vi.mock("@/utils/templates/validation", () => ({
  validateTemplateBody: vi.fn().mockReturnValue({ valid: true }),
  getTemplateValidationErrorMessage: vi.fn().mockReturnValue(""),
}));

interface TemplateForm {
  state: { values: Record<string, unknown> };
  setFieldValue: (k: string, v: unknown) => void;
  handleSubmit: () => Promise<void>;
}

const newScope: EditorDraftScope = {
  kind: "alert_template",
  org: "default",
  entityId: null,
  userEmail: "example@gmail.com",
};
const editScope: EditorDraftScope = { ...newScope, entityId: "pager_body" };

const savedTemplate = {
  name: "pager_body",
  body: '{"text":"{alert_name}"}',
  type: "http" as const,
  title: "",
  kind: "custom" as const,
};

let router: Router;
let wrapper: VueWrapper | null = null;
let editorProps: Record<string, unknown>;
const emitted = { cancel: 0, refresh: 0 };

const EditorRoute = defineComponent({
  setup() {
    return () =>
      h(AddTemplate, {
        template: null,
        ...editorProps,
        "onCancel:hideform": () => emitted.cancel++,
        "onGet:templates": () => emitted.refresh++,
      });
  },
});

const mountEditor = async (props: Record<string, unknown> = {}) => {
  editorProps = props;
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/alert-templates", name: "alertTemplates", component: EditorRoute },
      { path: "/logs", name: "logs", component: { render: () => h("div") } },
    ],
  });
  await router.push({
    name: "alertTemplates",
    query: props.template ? { action: "update", name: "pager_body" } : { action: "add" },
  });
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [i18n, store, router],
        stubs: {
          QueryEditor: { template: "<div />", props: ["query", "editorId", "language"] },
          ContentTemplateForm: true,
          TemplatePreviewPanel: true,
        },
      },
    },
  );
  await flushPromises();
};

const form = () =>
  (wrapper!.findComponent(AddTemplate).findComponent(OForm).vm as unknown as { form: TemplateForm })
    .form;

const edit = async (field: string, value: unknown) => {
  window.dispatchEvent(new Event("pointerdown"));
  form().setFieldValue(field, value);
  await nextTick();
};

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const leaveButton = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`,
  );

describe("AddTemplate drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    emitted.cancel = 0;
    emitted.refresh = 0;
    vi.mocked(templateService.create).mockClear();
    vi.mocked(templateService.update).mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("writes a new template's draft when the page hides", async () => {
    await mountEditor();
    await edit("name", "deploy_notice");
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<{ values: { name: string; kind: string } }>(newScope);
    expect(draft?.data.values).toMatchObject({ name: "deploy_notice", kind: "content" });
  });

  it("offers a new-template draft on open and continues it", async () => {
    writeEditorDraft(newScope, {
      data: {
        values: { name: "from_draft", type: "http", kind: "custom", title: "", body: '{"a":1}' },
        contentSpec: emptyContentSpec(),
        customBodyStash: null,
      },
    });
    await mountEditor();

    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain(
      "unsaved changes to this alert template",
    );
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    expect(form().state.values).toMatchObject({
      name: "from_draft",
      kind: "custom",
      body: '{"a":1}',
    });
  });

  it("a clone neither offers nor overwrites the new-template draft, and keeps its own", async () => {
    const newDraft = {
      values: { name: "from_draft", type: "http", kind: "custom", title: "", body: '{"a":1}' },
      contentSpec: emptyContentSpec(),
      customBodyStash: null,
    };
    writeEditorDraft(newScope, { data: newDraft });
    const clone = { template: { ...savedTemplate, name: "Copy_of_pager_body" }, isClone: true };
    await mountEditor({ ...clone, cloneSource: "pager_body" });

    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(form().state.values).toMatchObject({ name: "Copy_of_pager_body" });
    await edit("body", '{"text":"cloned"}');
    window.dispatchEvent(new Event("pagehide"));

    const cloneScope = { ...newScope, variant: "clone:pager_body" };
    expect(readEditorDraft<{ values: { body: string } }>(cloneScope)?.data.values.body).toBe(
      '{"text":"cloned"}',
    );
    expect(readEditorDraft(newScope)?.data).toEqual(newDraft);

    wrapper!.unmount();
    wrapper = null;
    await mountEditor({ ...clone, cloneSource: "pager_body" });
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
  });

  it("keys an edited template's draft by its name and the server copy", async () => {
    await mountEditor({ template: { ...savedTemplate } });
    await edit("body", '{"text":"changed"}');
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<{ values: { body: string } }>(editScope);
    expect(draft?.data.values.body).toBe('{"text":"changed"}');
    expect(draft?.baseHash).toBe(hashDraftValue(savedTemplate));
    expect(localStorage.getItem(editorDraftKey(newScope))).toBeNull();
  });

  it("Cancel with unsaved changes asks, and Discard closes and drops the draft", async () => {
    await mountEditor();
    await edit("name", "not_kept");
    window.dispatchEvent(new Event("pagehide"));

    await wrapper!.get('[data-test="add-template-cancel-btn"]').trigger("click");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    expect(emitted.cancel).toBe(0);

    leaveButton("o-dialog-neutral-btn")?.click();
    await flushPromises();
    expect(emitted.cancel).toBe(1);
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Save in the leave dialog saves without closing the editor itself, then Cancel closes it", async () => {
    await mountEditor();
    await edit("name", "saved_from_leave");

    await wrapper!.get('[data-test="add-template-cancel-btn"]').trigger("click");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await vi.waitFor(() => expect(emitted.cancel).toBe(1));

    expect(templateService.create).toHaveBeenCalledTimes(1);
    expect(emitted.refresh).toBe(0);
    expect(emitted.cancel).toBe(1);
  });

  it("guards the browser Back that drops ?action, and stays when the dialog is closed", async () => {
    await mountEditor();
    await edit("name", "half_done");

    const navigation = router.push({ name: "alertTemplates", query: {} });
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    leaveButton("o-dialog-close-btn")?.click();
    await navigation;

    expect(router.currentRoute.value.query.action).toBe("add");
  });

  it("Keep draft lets the route leave and keeps the work", async () => {
    await mountEditor();
    await edit("name", "kept_for_later");

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("o-dialog-secondary-btn")?.click();
    await navigation;

    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft<{ values: { name: string } }>(newScope)?.data.values.name).toBe(
      "kept_for_later",
    );
  });

  it("a normal save drops the draft and closes the editor without asking", async () => {
    await mountEditor({ template: { ...savedTemplate } });
    await edit("body", '{"text":"saved"}');
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(editScope)).not.toBeNull();

    await wrapper!.get('[data-test="add-template-submit-btn"]').trigger("click");
    await vi.waitFor(() => expect(emitted.cancel).toBe(1));

    expect(templateService.update).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual({ cancel: 1, refresh: 1 });
    expect(readEditorDraft(editScope)).toBeNull();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
  });
});
