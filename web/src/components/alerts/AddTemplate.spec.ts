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
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
}));

vi.mock("@/services/alert_templates", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      create: vi.fn().mockResolvedValue({ data: { code: 200 } }),
      update: vi.fn().mockResolvedValue({ data: { code: 200 } }),
      preview: vi.fn().mockResolvedValue({
        data: {
          variable_groups: [
            { name: "common", variables: ["alert_name"] },
            { name: "alert", variables: [] },
            { name: "anomaly", variables: ["anomaly_count"] },
          ],
        },
      }),
    },
  });
});

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

vi.mock("@/utils/templates/validation", () => ({
  validateTemplateBody: vi.fn().mockReturnValue({ valid: true }),
  getTemplateValidationErrorMessage: vi.fn().mockReturnValue(""),
}));

const draftOptions = vi.hoisted(() => ({ last: null as any }));
vi.mock("@/composables/useEditorDraft", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useEditorDraft: (options: any) => {
      draftOptions.last = options;
      return actual.useEditorDraft(options);
    },
  };
});

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

async function mountComp(props: Record<string, any> = {}, opts: Record<string, any> = {}) {
  const wrapper = mount(AddTemplate, {
    ...opts,
    props: {
      template: null,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        QueryEditor: editorStub,
        AppTabs: appTabsStub,
        ContentTemplateForm: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

// Most of this file exercises the legacy raw-payload ("custom") editor, which
// pre-migration was the only mode. New templates now default to CONTENT mode
// (brief: "new templates default to content mode"), so these tests select
// custom mode first via the mode AppTabs — the same bridge onModeChange uses.
// There are TWO AppTabs stubs once in custom mode (mode switch + http/email
// type switch); the mode switcher is always the first one rendered.
async function selectCustomMode(wrapper: any) {
  const modeTabs = wrapper.findAllComponents({ name: "AppTabs" });
  await modeTabs[0].vm.$emit("update:activeTab", "custom");
  await flushPromises();
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
    await selectCustomMode(w);
    const mountsAfterInitial = editorMounts;
    expect(w.findComponent({ name: "QueryEditor" }).props("language")).toBe("json");

    const typeTabs = w.findAllComponents({ name: "AppTabs" });
    await typeTabs[1].vm.$emit("update:activeTab", "email");
    await flushPromises();

    expect(w.findComponent({ name: "QueryEditor" }).props("language")).toBe("markdown");
    expect(editorMounts).toBe(mountsAfterInitial + 1);
  });

  it("remounts the body editor when the type flips back (email → http)", async () => {
    const w = await mountComp();
    await selectCustomMode(w);
    let typeTabs = w.findAllComponents({ name: "AppTabs" });
    await typeTabs[1].vm.$emit("update:activeTab", "email");
    await flushPromises();
    const mountsAfterEmail = editorMounts;

    typeTabs = w.findAllComponents({ name: "AppTabs" });
    await typeTabs[1].vm.$emit("update:activeTab", "http");
    await flushPromises();

    expect(w.findComponent({ name: "QueryEditor" }).props("language")).toBe("json");
    expect(editorMounts).toBe(mountsAfterEmail + 1);
  });

  // The remount must not cost the user their draft: monaco is recreated with
  // `value: props.query`, so the form-owned body has to survive the swap.
  it("preserves the typed body across the remount", async () => {
    const w = await mountComp();
    await selectCustomMode(w);
    getForm(w).setFieldValue("body", "# hello");
    await flushPromises();

    const typeTabs = w.findAllComponents({ name: "AppTabs" });
    await typeTabs[1].vm.$emit("update:activeTab", "email");
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
    await selectCustomMode(w);
    expect(w.find('[data-test="add-template-name-input"]').exists()).toBe(true);
    expect(w.find('[data-test="add-template-submit-btn"]').exists()).toBe(true);
    expect(w.find('[data-test="add-template-cancel-btn"]').exists()).toBe(true);
    expect(w.find('[data-test="add-template-body-input-title"]').exists()).toBe(true);
    expect(w.find('[data-test="template-body-editor"]').exists()).toBe(true);
  });

  it("hides the email title input for http (default) and shows it for email", async () => {
    const w = await mountComp();
    await selectCustomMode(w);
    expect(w.find('[data-test="add-template-email-title-input"]').exists()).toBe(false);

    // Bridge: driving the tabs toggle updates the form discriminator → v-if.
    const typeTabs = w.findAllComponents({ name: "AppTabs" });
    await typeTabs[1].vm.$emit("update:activeTab", "email");
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
    await selectCustomMode(w);
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
    await selectCustomMode(w);
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
        kind: "custom",
        applies_to: [],
      },
    });
    expect(templateService.update).not.toHaveBeenCalled();
  });

  it("creates an email template carrying the title", async () => {
    const w = await mountComp();
    await selectCustomMode(w);
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
        kind: "custom",
        applies_to: [],
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
        kind: "custom",
        applies_to: [],
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
    await selectCustomMode(w);
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
    await selectCustomMode(w);
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

describe("AddTemplate - refused save", () => {
  beforeEach(() => vi.clearAllMocks());

  it("closes its loading toast when the save is refused with a 403", async () => {
    const dismissLoading = vi.fn();
    vi.mocked(toast).mockReturnValueOnce(dismissLoading);
    vi.mocked(templateService.create).mockRejectedValueOnce({ response: { status: 403 } });
    const w = await mountComp();
    await selectCustomMode(w);
    const form = getForm(w);
    form.setFieldValue("name", "email-template");
    form.setFieldValue("type", "email");
    form.setFieldValue("title", "Subject");
    form.setFieldValue("body", "plain text");

    await submit(w);

    expect(templateService.create).toHaveBeenCalledTimes(1);
    expect(dismissLoading).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
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

describe("AddTemplate - mode switch picks kind from an existing template", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults to content mode for a brand-new template", async () => {
    const w = await mountComp();
    expect(getForm(w).state.values.kind).toBe("content");
    expect(w.find('[data-test="add-template-content-form"]').exists()).toBe(true);
  });

  it("seeds a brand-new template with the starter spec (Task 17 D2)", async () => {
    const w = await mountComp();
    const spec = (w.vm as any).contentSpec;
    expect(spec.title).not.toBe("");
    expect(spec.body).not.toBe("");
    expect(spec.rows.enabled).toBe(true);
  });

  // Live-UX-audit fix: a PRISTINE new template switched to raw mode must seed
  // an example webhook payload — not the serialized ContentSpec, which is an
  // internal representation that would be sent verbatim.
  it("seeds raw mode with an example payload when the spec is the untouched starter", async () => {
    const w = await mountComp();
    await selectCustomMode(w);
    const body = getForm(w).state.values.body as string;
    expect(body).toContain('"text"');
    expect(body).toContain("{alert_name}");
    expect(body).not.toContain("title_overrides");
  });

  it("keeps the serialize round-trip in raw mode once the spec has been edited", async () => {
    const w = await mountComp();
    (w.vm as any).contentSpec = {
      ...(w.vm as any).contentSpec,
      title: "My authored title",
    };
    await flushPromises();
    await selectCustomMode(w);
    const body = getForm(w).state.values.body as string;
    expect(body).toContain("title_overrides");
    expect(body).toContain("My authored title");
  });

  it("does NOT overwrite an existing template's spec with the starter spec", async () => {
    const spec = {
      title: "My saved title",
      title_overrides: {},
      body: "My saved body",
      fields: [],
      rows: { enabled: false, max: 5, columns: null, format: null },
      links: [],
      chart: { enabled: false },
    };
    const existingTemplate = {
      name: "content-template",
      body: JSON.stringify(spec),
      type: "http",
      title: "",
      kind: "content",
    };
    const w = await mountComp({ template: existingTemplate });
    expect((w.vm as any).contentSpec).toEqual(spec);
  });

  it("clone mode carries the source's spec, not the starter spec", async () => {
    const spec = {
      title: "Cloned title",
      title_overrides: {},
      body: "Cloned body",
      fields: [],
      rows: { enabled: false, max: 5, columns: null, format: null },
      links: [],
      chart: { enabled: false },
    };
    const sourceTemplate = {
      name: "source-template",
      body: JSON.stringify(spec),
      type: "http",
      title: "",
      kind: "content",
    };
    const w = await mountComp({ template: sourceTemplate, isClone: true });
    expect((w.vm as any).contentSpec).toEqual(spec);
  });

  it("opens an existing kind:content template in content mode", async () => {
    const spec = {
      title: "Alert fired",
      title_overrides: {},
      body: "{alert_name}",
      fields: [],
      rows: { enabled: false, max: 5, columns: null, format: null },
      links: [],
      chart: { enabled: false },
    };
    const existingTemplate = {
      name: "content-template",
      body: JSON.stringify(spec),
      type: "http",
      title: "",
      kind: "content",
    };
    const w = await mountComp({ template: existingTemplate });

    expect(getForm(w).state.values.kind).toBe("content");
    expect(w.find('[data-test="add-template-content-form"]').exists()).toBe(true);
    expect(w.find('[data-test="template-body-editor"]').exists()).toBe(false);
  });

  it("opens an existing kind:custom template in custom mode", async () => {
    const existingTemplate = {
      name: "custom-template",
      body: '{"text":"legacy"}',
      type: "http",
      title: "",
      kind: "custom",
    };
    const w = await mountComp({ template: existingTemplate });

    expect(getForm(w).state.values.kind).toBe("custom");
    expect(w.find('[data-test="template-body-editor"]').exists()).toBe(true);
    expect(w.find('[data-test="add-template-content-form"]').exists()).toBe(false);
  });

  it("opens a legacy template with no `kind` in custom mode (never guesses content)", async () => {
    const existingTemplate = {
      name: "legacy-template",
      body: '{"text":"legacy, no kind field"}',
      type: "http",
      title: "",
    };
    const w = await mountComp({ template: existingTemplate });

    expect(getForm(w).state.values.kind).toBe("custom");
    expect(w.find('[data-test="template-body-editor"]').exists()).toBe(true);
  });

  it("shows the legacy banner only for an existing custom template, not for a new one", async () => {
    const wNew = await mountComp();
    expect(wNew.find('[data-test="add-template-legacy-banner"]').exists()).toBe(false);

    const existingTemplate = {
      name: "custom-template",
      body: '{"text":"legacy"}',
      type: "http",
      title: "",
      kind: "custom",
    };
    const wExisting = await mountComp({ template: existingTemplate });
    expect(wExisting.find('[data-test="add-template-legacy-banner"]').exists()).toBe(true);
  });

  it("'start a content version' switches to content mode and seeds the body from detected {vars}", async () => {
    const existingTemplate = {
      name: "custom-template",
      body: '{"text":"{alert_name} fired on {stream_name}"}',
      type: "http",
      title: "",
      kind: "custom",
    };
    const w = await mountComp({ template: existingTemplate });

    await w.find('[data-test="add-template-start-content-version-btn"]').trigger("click");
    await flushPromises();

    expect(getForm(w).state.values.kind).toBe("content");
    expect((w.vm as any).contentSpec.body).toContain("{alert_name}");
    expect((w.vm as any).contentSpec.body).toContain("{stream_name}");
  });

  it("saves a content-mode template with kind explicitly set to content", async () => {
    const w = await mountComp();
    const form = getForm(w);
    form.setFieldValue("name", "new-content-template");
    (w.vm as any).contentSpec = {
      ...(w.vm as any).contentSpec,
      title: "My alert",
    };
    await flushPromises();

    await submit(w);

    expect(templateService.create).toHaveBeenCalledTimes(1);
    const sent = (templateService.create as any).mock.calls[0][0];
    expect(sent.data.kind).toBe("content");
    expect(sent.data.type).toBe("http");
    expect(sent.data.title).toBe("My alert");
    expect(() => JSON.parse(sent.data.body)).not.toThrow();
  });
});

// Live-reported bug: the Variable Guide collapsible starts OPEN in custom
// mode (`default-open`) but never remounts across a mode switch — it lives
// outside the `editorMode` v-if/v-else, in the OSplitter's `after` slot. It
// used `:default-open` (a one-time seed, not reactive) instead of `v-model`,
// so switching custom → content left it open, overlapping the now-visible
// TemplatePreviewPanel in the same scrollable column.
describe("AddTemplate - variable guide collapses when switching to content mode", () => {
  it("is open by default in custom mode and closes when switching to content mode", async () => {
    const w = await mountComp();
    await selectCustomMode(w);

    expect(w.html()).toContain('data-state="open"');

    const modeTabs = w.findAllComponents({ name: "AppTabs" });
    await modeTabs[0].vm.$emit("update:activeTab", "content");
    await flushPromises();

    expect(w.html()).toContain('data-state="closed"');
    expect(w.html()).not.toContain('data-state="open"');
  });

  it("stays closed when a new template starts in content mode", async () => {
    const w = await mountComp();

    expect(w.html()).toContain('data-state="closed"');
    expect(w.html()).not.toContain('data-state="open"');
  });
});

// P0 regression (o2-enterprise#2364): on an EXISTING custom template, the two
// mode tabs share the single form `body` field. Switching to the Template tab
// overwrote it with the serialized EMPTY spec (Template tab blank), and
// switching back left that empty-spec JSON in the editor (raw payload "reset")
// — original payload destroyed, and Save would persist the empty spec.
describe("AddTemplate - existing custom template survives a mode-tab round trip", () => {
  beforeEach(() => vi.clearAllMocks());

  const LEGACY_BODY = '{"text":"{alert_name} fired on {stream_name}"}';

  async function mountExistingCustom() {
    return mountComp({
      template: {
        name: "custom-template",
        body: LEGACY_BODY,
        type: "http",
        title: "",
        kind: "custom",
        applies_to: [],
      },
    });
  }

  async function selectMode(wrapper: any, mode: "content" | "custom") {
    const modeTabs = wrapper.findAllComponents({ name: "AppTabs" });
    await modeTabs[0].vm.$emit("update:activeTab", mode);
    await flushPromises();
  }

  it("restores the original raw payload when switching Template → Raw payload", async () => {
    const w = await mountExistingCustom();

    await selectMode(w, "content");
    await selectMode(w, "custom");

    expect(getForm(w).state.values.body).toBe(LEGACY_BODY);
  });

  it("restores raw-mode EDITS (not just the saved body) across the round trip", async () => {
    const w = await mountExistingCustom();
    getForm(w).setFieldValue("body", '{"text":"edited draft"}');
    await flushPromises();

    await selectMode(w, "content");
    await selectMode(w, "custom");

    expect(getForm(w).state.values.body).toBe('{"text":"edited draft"}');
  });

  it("prefills the Template tab from detected {vars} instead of opening blank", async () => {
    const w = await mountExistingCustom();

    await selectMode(w, "content");

    const spec = (w.vm as any).contentSpec;
    expect(spec.body).toContain("{alert_name}");
    expect(spec.body).toContain("{stream_name}");
  });

  it("'start a content version' then Raw payload restores the original body too", async () => {
    const w = await mountExistingCustom();

    await w.find('[data-test="add-template-start-content-version-btn"]').trigger("click");
    await flushPromises();
    await selectMode(w, "custom");

    expect(getForm(w).state.values.body).toBe(LEGACY_BODY);
  });
});

// o2-enterprise#2394: clearing the body and saving toasted "Please fill
// required fields" but left the Monaco editor visually unchanged — the user
// was told something was wrong with no indication of WHERE. The schema
// already produces an error on the `body` path; it simply had nowhere to
// render, because a bare Monaco is bridged in via setFieldValue and is not
// an OFormInput with an error slot.
describe("AddTemplate - required-field highlighting on failed save", () => {
  it("marks the body editor invalid and shows its message when body is empty", async () => {
    const w = await mountComp();
    await selectCustomMode(w);

    const form = getForm(w);
    form.setFieldValue("name", "my-template");
    form.setFieldValue("body", "");
    await submit(w);

    // The save must not have gone through.
    expect(form.state.isValid).toBe(false);

    // The editor must carry a visible error affordance...
    const shell = w.find('[data-test="add-template-body-editor-shell"]');
    expect(shell.exists()).toBe(true);
    expect(shell.attributes("data-error")).toBe("true");

    // ...and a message the user can actually read.
    const err = w.find('[data-test="add-template-body-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text().length).toBeGreaterThan(0);
  });

  it("clears the body error once a body is typed back in", async () => {
    const w = await mountComp();
    await selectCustomMode(w);

    const form = getForm(w);
    form.setFieldValue("name", "my-template");
    form.setFieldValue("body", "");
    await submit(w);
    expect(w.find('[data-test="add-template-body-error"]').exists()).toBe(true);

    form.setFieldValue("body", '{"text":"hi"}');
    await flushPromises();

    expect(w.find('[data-test="add-template-body-error"]').exists()).toBe(false);
    expect(w.find('[data-test="add-template-body-editor-shell"]').attributes("data-error")).toBe(
      "false",
    );
  });

  it("shows no body error before the first save attempt", async () => {
    const w = await mountComp();
    await selectCustomMode(w);
    expect(w.find('[data-test="add-template-body-error"]').exists()).toBe(false);
  });

  // The aria wiring must live on the SHELL, not on <QueryEditor>:
  // CodeQueryEditor has `inheritAttrs: false` and binds $attrs to a
  // non-focusable wrapper, so attributes passed to the component are inert
  // and would be false assurance for a screen-reader user.
  it("exposes the error to assistive tech on the shell, not the inert editor", async () => {
    const w = await mountComp();
    await selectCustomMode(w);

    const form = getForm(w);
    form.setFieldValue("name", "my-template");
    form.setFieldValue("body", "");
    await submit(w);

    const shell = w.find('[data-test="add-template-body-editor-shell"]');
    expect(shell.attributes("aria-invalid")).toBe("true");
    // ...and the described-by must resolve to a node that actually exists.
    const describedBy = shell.attributes("aria-describedby");
    expect(describedBy).toBeTruthy();
    const target = w.find(`#${describedBy}`);
    expect(target.exists()).toBe(true);
    expect(target.attributes("role")).toBe("alert");
  });
});

// The issue also names the title field. Email templates require a subject;
// unlike body it IS an OFormInput, so it should already highlight — pin that
// so the two required fields behave consistently.
describe("AddTemplate - email title highlighting", () => {
  it("marks the email title input invalid when it is empty on save", async () => {
    const w = await mountComp();
    await selectCustomMode(w);

    const form = getForm(w);
    form.setFieldValue("type", "email");
    form.setFieldValue("name", "my-template");
    form.setFieldValue("body", "hello");
    form.setFieldValue("title", "");
    await submit(w);

    expect(form.state.isValid).toBe(false);
    const err = w.find('[data-test="add-template-email-title-input-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text().length).toBeGreaterThan(0);
  });
});

// A rejected save must SHOW the user what is wrong. On this form the offending
// field is often scrolled out of view (the body editor is tall), so the toast
// alone left them hunting. The first invalid field is scrolled into view.
describe("AddTemplate - scrolls the first error into view on failed save", () => {
  it("scrolls to an invalid field when save is rejected", async () => {
    const scrollSpy = vi.fn();
    (Element.prototype as any).scrollIntoView = scrollSpy;

    // `attachTo: document.body` is REQUIRED: scrollToFirstError queries the
    // real document, and a detached wrapper would make it find nothing —
    // the test would fail while the app works.
    const w = await mountComp({}, { attachTo: document.body });
    await selectCustomMode(w);

    // Leave `name` empty so the schema rejects the submit.
    const form = getForm(w);
    form.setFieldValue("name", "");
    form.setFieldValue("body", "");
    // Click the real Save button: the scroll lives in handleSave, so calling
    // form.handleSubmit() directly would bypass exactly what we are testing.
    // Invoke the button's own handler: `trigger("click")` on the OButton
    // wrapper does not reliably reach the inner <button>, and the behaviour
    // under test is handleSave's, not Vue's event plumbing.
    await (w.vm as any).handleSave();
    await flushPromises();
    await nextTick();

    expect(form.state.isValid).toBe(false);
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("does not scroll when the form is valid", async () => {
    const scrollSpy = vi.fn();
    (Element.prototype as any).scrollIntoView = scrollSpy;

    const w = await mountComp({}, { attachTo: document.body });
    await selectCustomMode(w);
    const form = getForm(w);
    form.setFieldValue("name", "valid-name");
    form.setFieldValue("body", '{"text":"hi"}');
    await (w.vm as any).handleSave();
    await flushPromises();
    await nextTick();

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});

describe("AddTemplate - applies to", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const appliesTo = (w: any) =>
    w.find('[data-test="add-template-applies-to-select"]').findComponent({ name: "OSelect" });

  it("infers the kinds from the body until a chip is chosen, and Reset restores inference", async () => {
    const w = await mountComp();
    await selectCustomMode(w);
    const editor = w.findComponent({ name: "QueryEditor" });

    await editor.vm.$emit("update:query", '{"text":"{anomaly_count} anomalies"}');
    await flushPromises();
    expect(appliesTo(w).props("modelValue")).toEqual(["anomaly"]);

    await editor.vm.$emit("update:query", '{"text":"{check_name} {anomaly_count}"}');
    await flushPromises();
    expect(appliesTo(w).props("modelValue")).toEqual(["anomaly", "synthetics"]);

    // A chip click switches to manual: later body edits no longer change the list.
    await appliesTo(w).vm.$emit("update:modelValue", ["incident"]);
    await editor.vm.$emit("update:query", '{"text":"{downtime_name}"}');
    await flushPromises();
    expect(appliesTo(w).props("modelValue")).toEqual(["incident"]);

    await w.find('[data-test="add-template-applies-to-reset"]').trigger("click");
    await flushPromises();
    expect(appliesTo(w).props("modelValue")).toEqual(["downtime"]);
  });

  it("sends the chosen list as an explicit array", async () => {
    const w = await mountComp();
    await selectCustomMode(w);
    getForm(w).setFieldValue("name", "ops-card");
    await w.findComponent({ name: "QueryEditor" }).vm.$emit("update:query", '{"text":"x"}');
    await appliesTo(w).vm.$emit("update:modelValue", ["on_call", "anomaly"]);

    await submit(w);

    const sent = (templateService.create as any).mock.calls[0][0];
    expect(sent.data.applies_to).toEqual(["anomaly", "on_call"]);
  });

  it("lists All kinds first and ticking it clears the chosen kinds in one click", async () => {
    const w = await mountComp();
    await selectCustomMode(w);
    getForm(w).setFieldValue("name", "ops-card");
    await w.findComponent({ name: "QueryEditor" }).vm.$emit("update:query", '{"text":"x"}');
    expect((appliesTo(w).props("options") as any[])[0]).toEqual({
      label: "All kinds",
      value: "all_kinds",
    });
    expect(appliesTo(w).props("modelValue")).toEqual(["all_kinds"]);

    await appliesTo(w).vm.$emit("update:modelValue", ["anomaly", "incident"]);
    await appliesTo(w).vm.$emit("update:modelValue", ["anomaly", "incident", "all_kinds"]);
    await flushPromises();
    expect(appliesTo(w).props("modelValue")).toEqual(["all_kinds"]);
    expect(w.find('[data-test="add-template-applies-to-mode"]').text()).toBe(
      String(i18n.global.t("alert_templates.appliesToManual")),
    );
    expect(w.find('[data-test="add-template-applies-to-reset"]').exists()).toBe(true);

    await submit(w);
    expect((templateService.create as any).mock.calls[0][0].data.applies_to).toEqual([]);
  });

  it("ticking a kind while All kinds is ticked selects that kind alone", async () => {
    const w = await mountComp();
    await selectCustomMode(w);
    expect(appliesTo(w).props("modelValue")).toEqual(["all_kinds"]);

    await appliesTo(w).vm.$emit("update:modelValue", ["all_kinds", "synthetics"]);
    await flushPromises();
    expect(appliesTo(w).props("modelValue")).toEqual(["synthetics"]);
  });

  it("an existing template starts in manual mode with its stored list", async () => {
    const w = await mountComp({
      template: {
        name: "ops-card",
        body: '{"text":"{anomaly_count}"}',
        type: "http",
        title: "",
        applies_to: ["incident"],
      },
    });
    expect(appliesTo(w).props("modelValue")).toEqual(["incident"]);
    expect(w.find('[data-test="add-template-applies-to-reset"]').exists()).toBe(true);
  });

  it("an existing template stored as all kinds starts in manual mode", async () => {
    const w = await mountComp({
      template: { name: "ops-card", body: '{"text":"x"}', type: "http", title: "", applies_to: [] },
    });
    expect(appliesTo(w).props("modelValue")).toEqual(["all_kinds"]);
    expect(w.find('[data-test="add-template-applies-to-mode"]').text()).toBe(
      String(i18n.global.t("alert_templates.appliesToManual")),
    );
    expect(w.find('[data-test="add-template-applies-to-reset"]').exists()).toBe(true);
  });

  it("an existing all-kinds template stays all kinds on save after the body gains {check_target}", async () => {
    const w = await mountComp({
      template: { name: "ops-card", body: '{"text":"x"}', type: "http", title: "", applies_to: [] },
    });
    await w
      .findComponent({ name: "QueryEditor" })
      .vm.$emit("update:query", '{"text":"{check_target} is down"}');
    await flushPromises();
    expect(appliesTo(w).props("modelValue")).toEqual(["all_kinds"]);

    await submit(w);

    expect((templateService.update as any).mock.calls[0][0].data.applies_to).toEqual([]);
  });

  it("an existing template with a stored list starts in manual mode", async () => {
    const w = await mountComp({
      template: {
        name: "ops-card",
        body: '{"text":"x"}',
        type: "http",
        title: "",
        applies_to: ["incident"],
      },
    });
    expect(appliesTo(w).props("modelValue")).toEqual(["incident"]);
    expect(w.find('[data-test="add-template-applies-to-mode"]').text()).toBe(
      String(i18n.global.t("alert_templates.appliesToManual")),
    );
  });

  it("shows the narrowing 400 under the control and keeps the editor open", async () => {
    const message =
      "template is used for anomaly by: anomaly config 'error rate on web-logs'; remove the binding first";
    vi.mocked(templateService.update).mockRejectedValueOnce({
      response: { status: 400, data: { message } },
    });
    const w = await mountComp({
      template: { name: "ops-card", body: '{"text":"x"}', type: "http", title: "", applies_to: [] },
    });
    await appliesTo(w).vm.$emit("update:modelValue", ["incident"]);

    await submit(w);

    expect(String(appliesTo(w).props("errorMessage"))).toContain("anomaly config");
    expect(w.emitted("cancel:hideform")).toBeUndefined();
  });

  it("drafts, restores and compares the Applies to list and mode", async () => {
    const w = await mountComp({
      template: { name: "ops-card", body: '{"text":"x"}', type: "http", title: "", applies_to: [] },
    });
    const opts = draftOptions.last;
    expect(opts.base()).toMatchObject({ appliesTo: [], appliesToMode: "manual" });

    await appliesTo(w).vm.$emit("update:modelValue", ["incident", "anomaly"]);
    const drafted = opts.snapshot();
    expect(drafted).toMatchObject({ appliesTo: ["incident", "anomaly"], appliesToMode: "manual" });

    await w.find('[data-test="add-template-applies-to-reset"]').trigger("click");
    await flushPromises();
    expect(appliesTo(w).props("modelValue")).toEqual(["all_kinds"]);
    expect(w.find('[data-test="add-template-applies-to-mode"]').text()).toBe(
      String(i18n.global.t("alert_templates.appliesToInferred")),
    );

    await opts.apply(drafted, { notKeptPaths: [] });
    await flushPromises();
    expect(appliesTo(w).props("modelValue")).toEqual(["incident", "anomaly"]);
    expect(w.find('[data-test="add-template-applies-to-mode"]').text()).toBe(
      String(i18n.global.t("alert_templates.appliesToManual")),
    );

    await opts.apply(
      { ...drafted, appliesTo: [], appliesToMode: "inferred" },
      { notKeptPaths: [] },
    );
    await flushPromises();
    expect(appliesTo(w).props("modelValue")).toEqual(["all_kinds"]);
    expect(w.find('[data-test="add-template-applies-to-mode"]').text()).toBe(
      String(i18n.global.t("alert_templates.appliesToInferred")),
    );
  });

  it("fills the variable guide groups from the preview response", async () => {
    const w = await mountComp();
    await selectCustomMode(w);
    expect(w.find('[data-test="add-template-variable-group-common"]').exists()).toBe(true);
    expect(w.find('[data-test="add-template-variable-group-anomaly"]').exists()).toBe(true);
    await appliesTo(w).vm.$emit("update:modelValue", ["incident"]);
    await flushPromises();
    expect(w.find('[data-test="add-template-variable-group-anomaly"]').exists()).toBe(false);
  });
});

describe("AddTemplate - playground Kind drives the variables", () => {
  const groups = [
    { name: "common", variables: ["alert_name", "status_dot"] },
    { name: "alert", variables: ["alert_level"] },
    { name: "anomaly", variables: ["anomaly_score"] },
    { name: "downtime", variables: ["downtime_window", "downtime_targets"] },
  ];
  const panel = (w: any) => w.findComponent({ name: "TemplatePreviewPanel" });
  const kindSelect = (w: any) =>
    w.find('[data-test="template-preview-panel-kind-select"]').findComponent({ name: "OSelect" });
  const shownGroups = (w: any) =>
    w
      .findAll('[data-test^="add-template-variable-group-"]')
      .map((g: any) => g.attributes("data-test").replace("add-template-variable-group-", ""));
  const chips = (w: any) => w.findComponent({ name: "ContentTemplateForm" }).props("variables");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows common plus the previewed kind in the guide and the chips", async () => {
    const w = await mountComp();
    await panel(w).vm.$emit("variable-groups", groups);
    (w.vm as any).variableGuideOpen = true;
    await flushPromises();
    expect(shownGroups(w)).toEqual(["common", "alert"]);
    expect(chips(w)).toEqual(["alert_name", "status_dot", "alert_level"]);

    await kindSelect(w).vm.$emit("update:modelValue", "downtime");
    await flushPromises();
    expect(shownGroups(w)).toEqual(["common", "downtime"]);
    expect(chips(w)).toEqual(["alert_name", "status_dot", "downtime_window", "downtime_targets"]);
  });

  it("a cloned custom template lists every kind's group and its Kind narrows the guide", async () => {
    const templateService = (await import("@/services/alert_templates")).default as any;
    templateService.preview.mockResolvedValueOnce({ data: { variable_groups: groups } });
    const w = await mountComp({
      template: {
        name: "prebuilt_slack",
        body: '{"text":"{alert_name}"}',
        type: "http",
        title: "",
        kind: "custom",
        applies_to: [],
      },
      isClone: true,
    });
    (w.vm as any).variableGuideOpen = true;
    await flushPromises();
    expect(shownGroups(w)).toEqual(["common", "alert", "anomaly", "downtime"]);

    const guideKind = w
      .find('[data-test="add-template-variable-guide-kind-select"]')
      .findComponent({ name: "OSelect" });
    expect((guideKind.props("options") as any[]).map((o) => o.value)).toEqual([
      "all_kinds",
      "alert",
      "incident",
      "anomaly",
      "synthetics",
      "downtime",
      "on_call",
    ]);
    await guideKind.vm.$emit("update:modelValue", "downtime");
    await flushPromises();
    expect(shownGroups(w)).toEqual(["common", "downtime"]);
  });

  it("opens a template limited by Applies to on its first kind and offers only its kinds", async () => {
    const spec = {
      title: "Anomaly",
      title_overrides: {},
      body: "{anomaly_score}",
      fields: [],
      rows: { enabled: false, max: 5, columns: null, format: null },
      links: [],
      chart: { enabled: false },
    };
    const w = await mountComp({
      template: {
        name: "ops-card",
        body: JSON.stringify(spec),
        type: "http",
        title: "",
        kind: "content",
        applies_to: ["downtime", "anomaly"],
      },
    });
    await panel(w).vm.$emit("variable-groups", groups);
    (w.vm as any).variableGuideOpen = true;
    await flushPromises();
    expect(kindSelect(w).props("modelValue")).toBe("anomaly");
    expect((kindSelect(w).props("options") as any[]).map((o) => o.value)).toEqual([
      "anomaly",
      "downtime",
    ]);
    expect(shownGroups(w)).toEqual(["common", "anomaly"]);
  });

  it("follows Applies to in the custom editor, which has no playground", async () => {
    const w = await mountComp();
    await panel(w).vm.$emit("variable-groups", groups);
    await selectCustomMode(w);
    expect(shownGroups(w)).toEqual(["common", "alert", "anomaly", "downtime"]);
  });
});
