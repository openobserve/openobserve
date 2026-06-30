// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Behavior tests for EvalTemplateEditor after the OForm + Zod migration
// (online-evals-migration.md re-audit row). The old internals-driven tests
// (vm.form / vm.saving / calling vm.saveTemplate() directly) were rewritten to
// drive the REAL <OForm> so the schema actually gates submits — an unwired
// `:schema` would now be caught.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const mockPush = vi.fn();
let mockRouteParams: Record<string, string> = {};

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ params: mockRouteParams }),
}));

vi.mock("@/services/eval-template.service", () => ({
  evalTemplateService: {
    getTemplate: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
  },
}));

import EvalTemplateEditor from "@/enterprise/components/EvalTemplateEditor.vue";
import { evalTemplateService } from "@/services/eval-template.service";

const existingTemplate = {
  id: "tmpl-abc",
  name: "My Template",
  response_type: "score",
  description: "Some description",
  content: "Evaluate {{input}} on accuracy.",
  dimensions: ["accuracy", "relevance"],
  version: 2,
  created_at: Date.now(),
  updated_at: Date.now(),
};

async function mountEditor() {
  return mount(EvalTemplateEditor, {
    global: { plugins: [i18n, store] },
  });
}

function oform(w: any) {
  return w.findComponent({ name: "OForm" }).vm as any;
}
function setField(w: any, name: string, value: unknown) {
  oform(w).form.setFieldValue(name, value);
}
async function submit(w: any) {
  await oform(w).form.handleSubmit();
  await flushPromises();
}

describe("EvalTemplateEditor - rendering (create mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteParams = {};
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the editor page + real OForm", async () => {
    const wrapper = await mountEditor();
    expect(wrapper.find('[data-test="eval-template-editor-page"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "OForm" }).exists()).toBe(true);
  });

  it("renders the title, back, cancel and save buttons", async () => {
    const wrapper = await mountEditor();
    expect(wrapper.find('[data-test="eval-template-editor-title"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="eval-template-editor-back-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="eval-template-editor-cancel-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="eval-template-editor-save-btn"]').exists()).toBe(true);
  });

  it("shows the create title + save label in create mode", async () => {
    const wrapper = await mountEditor();
    expect(wrapper.find('[data-test="eval-template-editor-title"]').text()).toContain("Create");
    const btn = wrapper.find('[data-test="eval-template-editor-save-btn"]');
    expect(btn.text().toLowerCase()).toContain("save");
  });

  it("keeps Save enabled with no errors before first submit (R3)", async () => {
    const wrapper = await mountEditor();
    const save = wrapper.find('[data-test="eval-template-editor-save-btn"]');
    expect(save.attributes("disabled")).toBeUndefined();
    expect(oform(wrapper).form.state.isValid).toBe(true);
  });
});

describe("EvalTemplateEditor - rendering (edit mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteParams = { id: "tmpl-abc" };
    vi.mocked(evalTemplateService.getTemplate).mockResolvedValue(existingTemplate as any);
  });
  afterEach(() => vi.restoreAllMocks());

  it("calls getTemplate on mount with the route id", async () => {
    await mountEditor();
    await flushPromises();
    expect(evalTemplateService.getTemplate).toHaveBeenCalledWith(expect.any(String), "tmpl-abc");
  });

  it("resets the form from the fetched template", async () => {
    const wrapper: any = await mountEditor();
    await flushPromises();
    const values = oform(wrapper).form.state.values;
    expect(values.name).toBe(existingTemplate.name);
    expect(values.response_type).toBe(existingTemplate.response_type);
    expect(values.content).toBe(existingTemplate.content);
    expect(values.dimensions).toEqual(existingTemplate.dimensions);
  });

  it("shows the edit title + update label", async () => {
    const wrapper = await mountEditor();
    await flushPromises();
    expect(wrapper.find('[data-test="eval-template-editor-title"]').text()).toContain("Edit");
    const btn = wrapper.find('[data-test="eval-template-editor-save-btn"]');
    expect(btn.text().toLowerCase()).toContain("update");
  });
});

describe("EvalTemplateEditor - schema validation (create mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteParams = {};
    vi.mocked(evalTemplateService.createTemplate).mockResolvedValue(existingTemplate as any);
  });
  afterEach(() => vi.restoreAllMocks());

  const fillValid = (w: any) => {
    setField(w, "name", "New Template");
    setField(w, "response_type", "score");
    setField(w, "content", "Evaluate {{input}}.");
    setField(w, "dimensions", ["accuracy", "relevance"]);
  };

  it("blocks an empty submit and does NOT call createTemplate", async () => {
    const wrapper = await mountEditor();
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(evalTemplateService.createTemplate).not.toHaveBeenCalled();
  });

  it.each(["name", "response_type", "content"])(
    "blocks submit when %s is missing",
    async (field) => {
      const wrapper = await mountEditor();
      fillValid(wrapper);
      setField(wrapper, field, "");
      await submit(wrapper);
      expect(oform(wrapper).form.state.isValid).toBe(false);
      expect(evalTemplateService.createTemplate).not.toHaveBeenCalled();
    },
  );

  it("blocks submit when dimensions are empty", async () => {
    const wrapper = await mountEditor();
    fillValid(wrapper);
    setField(wrapper, "dimensions", []);
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(evalTemplateService.createTemplate).not.toHaveBeenCalled();
  });

  it("calls createTemplate + navigates when the schema passes", async () => {
    const wrapper = await mountEditor();
    fillValid(wrapper);
    await submit(wrapper);

    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(evalTemplateService.createTemplate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        name: "New Template",
        response_type: "score",
        content: "Evaluate {{input}}.",
        dimensions: ["accuracy", "relevance"],
      }),
    );
    expect(mockPush).toHaveBeenCalledWith({ name: "evalTemplates" });
  });
});

describe("EvalTemplateEditor - save (edit mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteParams = { id: "tmpl-abc" };
    vi.mocked(evalTemplateService.getTemplate).mockResolvedValue(existingTemplate as any);
    vi.mocked(evalTemplateService.updateTemplate).mockResolvedValue(existingTemplate as any);
  });
  afterEach(() => vi.restoreAllMocks());

  it("calls updateTemplate (not create) with the route id and navigates", async () => {
    const wrapper = await mountEditor();
    await flushPromises(); // edit prefill makes the form valid
    await submit(wrapper);
    expect(evalTemplateService.updateTemplate).toHaveBeenCalledWith(
      expect.any(String),
      "tmpl-abc",
      expect.any(Object),
    );
    expect(evalTemplateService.createTemplate).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({ name: "evalTemplates" });
  });
});

describe("EvalTemplateEditor - cancel / back", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteParams = {};
  });
  afterEach(() => vi.restoreAllMocks());

  it("navigates to the list when cancel is clicked", async () => {
    const wrapper = await mountEditor();
    await wrapper.find('[data-test="eval-template-editor-cancel-btn"]').trigger("click");
    expect(mockPush).toHaveBeenCalledWith({ name: "evalTemplates" });
  });

  it("navigates to the list when back is clicked", async () => {
    const wrapper = await mountEditor();
    await wrapper.find('[data-test="eval-template-editor-back-btn"]').trigger("click");
    expect(mockPush).toHaveBeenCalledWith({ name: "evalTemplates" });
  });
});
