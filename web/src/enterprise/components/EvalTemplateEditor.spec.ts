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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

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

// ── Helpers ────────────────────────────────────────────────────────────────────

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
    global: {
      plugins: [i18n, store],
    },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("EvalTemplateEditor - rendering (create mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteParams = {};
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders the editor page container", async () => {
    const wrapper = await mountEditor();
    expect(wrapper.find('[data-test="eval-template-editor-page"]').exists()).toBe(true);
  });

  it("renders the page title", async () => {
    const wrapper = await mountEditor();
    expect(wrapper.find('[data-test="eval-template-editor-title"]').exists()).toBe(true);
  });

  it("shows create title in create mode", async () => {
    const wrapper = await mountEditor();
    const title = wrapper.find('[data-test="eval-template-editor-title"]');
    expect(title.text()).toContain("Create");
  });

  it("renders back button", async () => {
    const wrapper = await mountEditor();
    expect(wrapper.find('[data-test="eval-template-editor-back-btn"]').exists()).toBe(true);
  });

  it("renders cancel button", async () => {
    const wrapper = await mountEditor();
    expect(wrapper.find('[data-test="eval-template-editor-cancel-btn"]').exists()).toBe(true);
  });

  it("renders save button", async () => {
    const wrapper = await mountEditor();
    expect(wrapper.find('[data-test="eval-template-editor-save-btn"]').exists()).toBe(true);
  });

  it("save button label is 'save' in create mode", async () => {
    const wrapper = await mountEditor();
    const btn = wrapper.find('[data-test="eval-template-editor-save-btn"]');
    expect(btn.text().toLowerCase()).toContain("save");
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
    expect(evalTemplateService.getTemplate).toHaveBeenCalledWith(
      expect.any(String),
      "tmpl-abc",
    );
  });

  it("populates form fields from fetched template", async () => {
    const wrapper: any = await mountEditor();
    await flushPromises();
    expect(wrapper.vm.form.name).toBe(existingTemplate.name);
    expect(wrapper.vm.form.response_type).toBe(existingTemplate.response_type);
    expect(wrapper.vm.form.content).toBe(existingTemplate.content);
  });

  it("populates dimensionsInput from fetched template", async () => {
    const wrapper: any = await mountEditor();
    await flushPromises();
    expect(wrapper.vm.dimensionsInput).toEqual(existingTemplate.dimensions);
  });

  it("shows edit title in edit mode", async () => {
    const wrapper = await mountEditor();
    await flushPromises();
    const title = wrapper.find('[data-test="eval-template-editor-title"]');
    expect(title.text()).toContain("Edit");
  });

  it("save button label is 'update' in edit mode", async () => {
    const wrapper = await mountEditor();
    await flushPromises();
    const btn = wrapper.find('[data-test="eval-template-editor-save-btn"]');
    expect(btn.text().toLowerCase()).toContain("update");
  });
});

describe("EvalTemplateEditor - initial state (create mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteParams = {};
  });

  afterEach(() => vi.restoreAllMocks());

  it("form fields are empty on init", async () => {
    const wrapper: any = await mountEditor();
    expect(wrapper.vm.form.name).toBe("");
    expect(wrapper.vm.form.response_type).toBe("");
    expect(wrapper.vm.form.content).toBe("");
    expect(wrapper.vm.form.description).toBe("");
  });

  it("dimensionsInput is empty on init", async () => {
    const wrapper: any = await mountEditor();
    expect(wrapper.vm.dimensionsInput).toEqual([]);
  });

  it("saving is false on init", async () => {
    const wrapper: any = await mountEditor();
    expect(wrapper.vm.saving).toBe(false);
  });
});

describe("EvalTemplateEditor - validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteParams = {};
  });

  afterEach(() => vi.restoreAllMocks());

  it("does not call createTemplate when name is empty", async () => {
    const wrapper: any = await mountEditor();
    wrapper.vm.form.name = "";
    wrapper.vm.form.response_type = "score";
    wrapper.vm.dimensionsInput = ["accuracy"];
    wrapper.vm.form.content = "Evaluate this.";
    await wrapper.vm.saveTemplate();
    expect(evalTemplateService.createTemplate).not.toHaveBeenCalled();
  });

  it("does not call createTemplate when response_type is empty", async () => {
    const wrapper: any = await mountEditor();
    wrapper.vm.form.name = "My Template";
    wrapper.vm.form.response_type = "";
    wrapper.vm.dimensionsInput = ["accuracy"];
    wrapper.vm.form.content = "Evaluate this.";
    await wrapper.vm.saveTemplate();
    expect(evalTemplateService.createTemplate).not.toHaveBeenCalled();
  });

  it("does not call createTemplate when dimensions are empty", async () => {
    const wrapper: any = await mountEditor();
    wrapper.vm.form.name = "My Template";
    wrapper.vm.form.response_type = "score";
    wrapper.vm.dimensionsInput = [];
    wrapper.vm.form.content = "Evaluate this.";
    await wrapper.vm.saveTemplate();
    expect(evalTemplateService.createTemplate).not.toHaveBeenCalled();
  });

  it("does not call createTemplate when content is empty", async () => {
    const wrapper: any = await mountEditor();
    wrapper.vm.form.name = "My Template";
    wrapper.vm.form.response_type = "score";
    wrapper.vm.dimensionsInput = ["accuracy"];
    wrapper.vm.form.content = "";
    await wrapper.vm.saveTemplate();
    expect(evalTemplateService.createTemplate).not.toHaveBeenCalled();
  });
});

describe("EvalTemplateEditor - save (create mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteParams = {};
    vi.mocked(evalTemplateService.createTemplate).mockResolvedValue(existingTemplate as any);
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls createTemplate with correct payload when form is valid", async () => {
    const wrapper: any = await mountEditor();
    wrapper.vm.form.name = "New Template";
    wrapper.vm.form.response_type = "score";
    wrapper.vm.form.description = "desc";
    wrapper.vm.form.content = "Evaluate {{input}}.";
    wrapper.vm.dimensionsInput = ["accuracy", "relevance"];
    await wrapper.vm.saveTemplate();
    await flushPromises();
    expect(evalTemplateService.createTemplate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        name: "New Template",
        response_type: "score",
        content: "Evaluate {{input}}.",
        dimensions: ["accuracy", "relevance"],
      }),
    );
  });

  it("navigates to evalTemplates list after successful create", async () => {
    const wrapper: any = await mountEditor();
    wrapper.vm.form.name = "New Template";
    wrapper.vm.form.response_type = "score";
    wrapper.vm.form.content = "Evaluate {{input}}.";
    wrapper.vm.dimensionsInput = ["accuracy"];
    await wrapper.vm.saveTemplate();
    await flushPromises();
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

  it("calls updateTemplate instead of createTemplate in edit mode", async () => {
    const wrapper: any = await mountEditor();
    await flushPromises();
    await wrapper.vm.saveTemplate();
    await flushPromises();
    expect(evalTemplateService.updateTemplate).toHaveBeenCalled();
    expect(evalTemplateService.createTemplate).not.toHaveBeenCalled();
  });

  it("calls updateTemplate with route id", async () => {
    const wrapper: any = await mountEditor();
    await flushPromises();
    await wrapper.vm.saveTemplate();
    await flushPromises();
    expect(evalTemplateService.updateTemplate).toHaveBeenCalledWith(
      expect.any(String),
      "tmpl-abc",
      expect.any(Object),
    );
  });

  it("navigates to evalTemplates list after successful update", async () => {
    const wrapper: any = await mountEditor();
    await flushPromises();
    await wrapper.vm.saveTemplate();
    await flushPromises();
    expect(mockPush).toHaveBeenCalledWith({ name: "evalTemplates" });
  });
});

describe("EvalTemplateEditor - cancel / back", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteParams = {};
  });

  afterEach(() => vi.restoreAllMocks());

  it("navigates to evalTemplates list when cancel is clicked", async () => {
    const wrapper = await mountEditor();
    await wrapper.find('[data-test="eval-template-editor-cancel-btn"]').trigger("click");
    expect(mockPush).toHaveBeenCalledWith({ name: "evalTemplates" });
  });

  it("navigates to evalTemplates list when back button is clicked", async () => {
    const wrapper = await mountEditor();
    await wrapper.find('[data-test="eval-template-editor-back-btn"]').trigger("click");
    expect(mockPush).toHaveBeenCalledWith({ name: "evalTemplates" });
  });
});

describe("EvalTemplateEditor - dimension filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteParams = {};
  });

  afterEach(() => vi.restoreAllMocks());

  it("filterDimensions returns matching options", async () => {
    const wrapper: any = await mountEditor();
    wrapper.vm.filterDimensions("acc", (fn: () => void) => fn());
    expect(wrapper.vm.filteredDimensionOptions).toContain("accuracy");
    expect(wrapper.vm.filteredDimensionOptions).not.toContain("relevance");
  });

  it("filterDimensions resets to all options when query is empty", async () => {
    const wrapper: any = await mountEditor();
    wrapper.vm.filterDimensions("acc", (fn: () => void) => fn());
    wrapper.vm.filterDimensions("", (fn: () => void) => fn());
    expect(wrapper.vm.filteredDimensionOptions.length).toBe(11); // all 11 defaults
  });
});
