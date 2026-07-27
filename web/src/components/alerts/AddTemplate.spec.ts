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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("vue-router", () => ({
  useRouter: () => ({ currentRoute: { value: { query: {} } }, push: vi.fn() }),
  useRoute: () => ({ params: {}, query: {} }),
}));

vi.mock("@/services/alert_templates", () => ({
  default: {
    create: vi.fn().mockResolvedValue({ data: { code: 200 } }),
    update: vi.fn().mockResolvedValue({ data: { code: 200 } }),
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

vi.mock("@/utils/templates/validation", () => ({
  validateTemplateBody: vi.fn().mockReturnValue({ valid: true }),
  getTemplateValidationErrorMessage: vi.fn().mockReturnValue(""),
}));

// toast returns a `dismiss` function (used for the loading toast) — mock it so
// no real toast renders and so we can assert the http JSON-validity toast.
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => () => {}),
}));

import AddTemplate from "@/components/alerts/AddTemplate.vue";
import templateService from "@/services/alert_templates";
import { validateTemplateBody } from "@/utils/templates/validation";
import { toast } from "@/lib/feedback/Toast/useToast";

const ORG = store.state.selectedOrganization.identifier;

// Counts editor CREATIONS. The real CodeQueryEditor reads `language` only at
// monaco.editor.create() and never watches the prop, so asserting the prop
// changed proves nothing — only a remount actually re-languages the editor.
let editorMounts = 0;

const editorStub = {
  name: "QueryEditor",
  template: '<div class="stub-editor"></div>',
  props: ["query", "editorId", "language"],
  emits: ["update:query"],
  mounted() {
    editorMounts += 1;
  },
};

const appTabsStub = {
  name: "AppTabs",
  template: '<div data-test="app-tabs-stub"></div>',
  props: ["tabs", "activeTab"],
  emits: ["update:activeTab"],
};

async function mountComp(props: Record<string, any> = {}) {
  const wrapper = mount(AddTemplate, {
    props: {
      template: null,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        QueryEditor: editorStub,
        AppTabs: appTabsStub,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

// Grab the REAL <OForm>'s underlying TanStack form (the single source of truth).
function getForm(wrapper: any) {
  return (wrapper.findComponent({ name: "OForm" }).vm as any).form;
}

async function submit(wrapper: any) {
  await getForm(wrapper).handleSubmit();
  await flushPromises();
}

describe("AddTemplate - body editor language", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editorMounts = 0;
  });

  // Pre-migration rendered TWO <query-editor> under v-if/v-else with hardcoded
  // language="markdown"/"json", so flipping the type destroyed one and created
  // the other. The migration collapsed them into one editor with a reactive
  // :language — which the editor never watches. Without the :key the mount-time
  // language sticks and a markdown body renders with JSON syntax errors.
  it("remounts the body editor when the type flips (http → email)", async () => {
    const w = await mountComp();
    const mountsAfterInitial = editorMounts;
    expect(w.findComponent({ name: "QueryEditor" }).props("language")).toBe("json");

    await w.findComponent({ name: "AppTabs" }).vm.$emit("update:activeTab", "email");
    await flushPromises();

    expect(w.findComponent({ name: "QueryEditor" }).props("language")).toBe("markdown");
    expect(editorMounts).toBe(mountsAfterInitial + 1);
  });

  it("remounts the body editor when the type flips back (email → http)", async () => {
    const w = await mountComp();
    await w.findComponent({ name: "AppTabs" }).vm.$emit("update:activeTab", "email");
    await flushPromises();
    const mountsAfterEmail = editorMounts;

    await w.findComponent({ name: "AppTabs" }).vm.$emit("update:activeTab", "http");
    await flushPromises();

    expect(w.findComponent({ name: "QueryEditor" }).props("language")).toBe("json");
    expect(editorMounts).toBe(mountsAfterEmail + 1);
  });

  // The remount must not cost the user their draft: monaco is recreated with
  // `value: props.query`, so the form-owned body has to survive the swap.
  it("preserves the typed body across the remount", async () => {
    const w = await mountComp();
    getForm(w).setFieldValue("body", "# hello");
    await flushPromises();

    await w.findComponent({ name: "AppTabs" }).vm.$emit("update:activeTab", "email");
    await flushPromises();

    expect(w.findComponent({ name: "QueryEditor" }).props("query")).toBe("# hello");
  });
});

describe("AddTemplate - rendering (create mode)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders without errors", async () => {
    const w = await mountComp();
    expect(w.exists()).toBe(true);
  });

  it("renders the add title when template is null", async () => {
    const w = await mountComp();
    const titleEl = w.find('[data-test="add-template-title"]');
    expect(titleEl.exists()).toBe(true);
    expect(titleEl.text()).toContain("New template");
  });

  it("preserves the core data-tests", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="add-template-name-input"]').exists()).toBe(true);
    expect(w.find('[data-test="add-template-submit-btn"]').exists()).toBe(true);
    expect(w.find('[data-test="add-template-cancel-btn"]').exists()).toBe(true);
    expect(w.find('[data-test="add-template-body-input-title"]').exists()).toBe(true);
    expect(w.find('[data-test="template-body-editor"]').exists()).toBe(true);
  });

  it("hides the email title input for http (default) and shows it for email", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="add-template-email-title-input"]').exists()).toBe(false);

    // Bridge: driving the tabs toggle updates the form discriminator → v-if.
    await w.findComponent({ name: "AppTabs" }).vm.$emit("update:activeTab", "email");
    await nextTick();
    expect(w.find('[data-test="add-template-email-title-input"]').exists()).toBe(true);
  });

  it("Save button stays enabled (R3 — never disabled before submit)", async () => {
    const w = await mountComp();
    const saveBtn = w.find('[data-test="add-template-submit-btn"]');
    expect(saveBtn.attributes("disabled")).toBeUndefined();
  });
});

describe("AddTemplate - rendering (update mode)", () => {
  beforeEach(() => vi.clearAllMocks());

  const existingTemplate = {
    name: "my-template",
    body: JSON.stringify({ text: "Alert {{name}} fired" }),
    type: "http",
    title: "",
  };

  it("shows the update title when a template prop is provided", async () => {
    const w = await mountComp({ template: existingTemplate });
    expect(w.find('[data-test="add-template-title"]').text()).toContain("Update");
  });

  it("marks the form as updating (name becomes readonly)", async () => {
    const w = await mountComp({ template: existingTemplate });
    expect((w.vm as any).isUpdatingTemplate).toBe(true);
  });

  it("prefills the form from the template via form.reset", async () => {
    const w = await mountComp({ template: existingTemplate });
    const form = getForm(w);
    expect(form.state.values.name).toBe("my-template");
    expect(form.state.values.body).toBe(existingTemplate.body);
    expect(form.state.values.type).toBe("http");
  });

  it("clone mode prefills but stays in create mode", async () => {
    const w = await mountComp({ template: existingTemplate, isClone: true });
    expect((w.vm as any).isUpdatingTemplate).toBe(false);
    expect(getForm(w).state.values.name).toBe("my-template");
    expect(w.find('[data-test="add-template-title"]').text()).toContain("Clone");
  });
});

describe("AddTemplate - validation (real OForm)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks submit and does NOT call the service when required fields are empty", async () => {
    const w = await mountComp();
    const form = getForm(w);

    await submit(w);

    expect(form.state.isValid).toBe(false);
    expect(templateService.create).not.toHaveBeenCalled();
    expect(templateService.update).not.toHaveBeenCalled();
  });

  it("blocks submit when body is empty (body required)", async () => {
    const w = await mountComp();
    const form = getForm(w);
    form.setFieldValue("name", "valid-name");
    form.setFieldValue("body", "");

    await submit(w);

    expect(form.state.isValid).toBe(false);
    expect(templateService.create).not.toHaveBeenCalled();
  });

  // R7 PARITY: pre-migration `isTemplateFilled()` gated on
  // `body.trim().trim().length`, so a whitespace-only body was INVALID. A plain
  // `.min(1)` passes "   " (length 3) — this test fails without the `.refine`.
  it("blocks submit when body is WHITESPACE-ONLY (parity: trim().length)", async () => {
    const w = await mountComp();
    const form = getForm(w);
    form.setFieldValue("name", "valid-name");
    form.setFieldValue("body", "   \n\t  ");

    await submit(w);

    expect(form.state.isValid).toBe(false);
    expect(templateService.create).not.toHaveBeenCalled();
  });

  // The body must be VALIDATED on the trimmed value but SAVED raw — a `.trim()`
  // transform would mutate what pre-migration sent to the backend.
  it("saves the body RAW (surrounding whitespace preserved, not trimmed)", async () => {
    const w = await mountComp();
    const form = getForm(w);
    const rawBody = '  {"text":"x"}  ';
    form.setFieldValue("name", "valid-name");
    form.setFieldValue("body", rawBody);

    await submit(w);

    expect(form.state.isValid).toBe(true);
    expect(templateService.create).toHaveBeenCalledTimes(1);
    const sent = (templateService.create as any).mock.calls[0][0];
    expect(sent.data.body).toBe(rawBody);
  });

  it("blocks submit for an invalid resource name", async () => {
    const w = await mountComp();
    const form = getForm(w);
    form.setFieldValue("name", "bad name/#"); // spaces + reserved chars
    form.setFieldValue("body", '{"text":"x"}');

    await submit(w);

    expect(form.state.isValid).toBe(false);
    expect(templateService.create).not.toHaveBeenCalled();
  });

  it("requires a title when type is email", async () => {
    const w = await mountComp();
    const form = getForm(w);
    form.setFieldValue("name", "email-template");
    form.setFieldValue("type", "email");
    form.setFieldValue("body", "hello");
    // title left empty

    await submit(w);

    expect(form.state.isValid).toBe(false);
    expect(templateService.create).not.toHaveBeenCalled();
  });
});

describe("AddTemplate - save payload parity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates an http template with the EXACT payload", async () => {
    const w = await mountComp();
    const form = getForm(w);
    form.setFieldValue("name", "new-template");
    // Body is bridged from the Monaco editor's change handler.
    await w.findComponent({ name: "QueryEditor" }).vm.$emit("update:query", '{"text":"alert"}');

    await submit(w);

    expect(templateService.create).toHaveBeenCalledTimes(1);
    expect(templateService.create).toHaveBeenCalledWith({
      org_identifier: ORG,
      template_name: "new-template",
      data: {
        name: "new-template",
        body: '{"text":"alert"}',
        type: "http",
        title: "",
      },
    });
    expect(templateService.update).not.toHaveBeenCalled();
  });

  it("creates an email template carrying the title", async () => {
    const w = await mountComp();
    const form = getForm(w);
    form.setFieldValue("name", "email-template");
    form.setFieldValue("type", "email");
    form.setFieldValue("title", "My subject");
    form.setFieldValue("body", "Body text");

    await submit(w);

    expect(templateService.create).toHaveBeenCalledWith({
      org_identifier: ORG,
      template_name: "email-template",
      data: {
        name: "email-template",
        body: "Body text",
        type: "email",
        title: "My subject",
      },
    });
  });

  it("updates in update mode with the EXACT payload", async () => {
    const existingTemplate = {
      name: "my-template",
      body: '{"text":"existing"}',
      type: "http",
      title: "",
    };
    const w = await mountComp({ template: existingTemplate });
    const form = getForm(w);
    form.setFieldValue("body", '{"text":"updated"}');

    await submit(w);

    expect(templateService.update).toHaveBeenCalledTimes(1);
    expect(templateService.update).toHaveBeenCalledWith({
      org_identifier: ORG,
      template_name: "my-template",
      data: {
        name: "my-template",
        body: '{"text":"updated"}',
        type: "http",
        title: "",
      },
    });
    expect(templateService.create).not.toHaveBeenCalled();
  });
});

describe("AddTemplate - http JSON-validity toast (Rule ④ side-effect)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires the error toast and blocks save when http body is invalid JSON", async () => {
    vi.mocked(validateTemplateBody).mockReturnValueOnce({ valid: false });
    const w = await mountComp();
    const form = getForm(w);
    form.setFieldValue("name", "http-template");
    form.setFieldValue("body", "{ invalid json"); // non-empty → passes schema

    await submit(w);

    // Schema passed (name + body non-empty) so @submit ran, but the JSON toast
    // guard blocked the actual create.
    expect(form.state.isValid).toBe(true);
    expect(templateService.create).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("does NOT run the JSON check for email templates (non-JSON body allowed)", async () => {
    const w = await mountComp();
    const form = getForm(w);
    form.setFieldValue("name", "email-template");
    form.setFieldValue("type", "email");
    form.setFieldValue("title", "Subject");
    form.setFieldValue("body", "plain text, not json");

    await submit(w);

    expect(validateTemplateBody).not.toHaveBeenCalled();
    expect(templateService.create).toHaveBeenCalledTimes(1);
  });
});

describe("AddTemplate - cancel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emits cancel:hideform when cancel is clicked", async () => {
    const w = await mountComp();
    await w.find('[data-test="add-template-cancel-btn"]').trigger("click");
    expect(w.emitted("cancel:hideform")).toBeTruthy();
  });
});
