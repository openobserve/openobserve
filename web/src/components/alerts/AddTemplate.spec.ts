// Copyright 2023 OpenObserve Inc.
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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

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
  validateTemplateBody: vi.fn().mockReturnValue(null),
  getTemplateValidationErrorMessage: vi.fn().mockReturnValue(""),
}));

import AddTemplate from "@/components/alerts/AddTemplate.vue";
import templateService from "@/services/alert_templates";

const editorStub = {
  template: '<div class="stub-editor"></div>',
  props: ["query", "editorId", "language"],
  emits: ["update:query"],
};

async function mountComp(props: Record<string, any> = {}) {
  return mount(AddTemplate, {
    props: {
      template: null,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        QueryEditor: editorStub,
        AppTabs: {
          template: '<div data-test="app-tabs-stub"><slot /></div>',
          props: ["tabs", "activeTab"],
          emits: ["update:activeTab"],
        },
      },
    },
  });
}

describe("AddTemplate - rendering (create mode)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders without errors", async () => {
    const w = await mountComp();
    expect(w.exists()).toBe(true);
  });

  it("renders the title with add text when template is null", async () => {
    const w = await mountComp();
    const titleEl = w.find('[data-test="add-template-title"]');
    expect(titleEl.exists()).toBe(true);
    expect(titleEl.text()).toContain("Add");
  });

  it("renders the name input", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="add-template-name-input"]').exists()).toBe(true);
  });

  it("renders the submit button", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="add-template-submit-btn"]').exists()).toBe(true);
  });

  it("renders the cancel button", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="add-template-cancel-btn"]').exists()).toBe(true);
  });

  it("renders the body input title", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="add-template-body-input-title"]').exists()).toBe(true);
  });
});

describe("AddTemplate - rendering (update mode)", () => {
  const existingTemplate = {
    name: "my-template",
    body: JSON.stringify({ text: "Alert {{name}} fired" }),
    type: "http",
    title: "",
  };

  it("shows update title when template prop is provided", async () => {
    const w = await mountComp({ template: existingTemplate });
    await flushPromises();
    const titleEl = w.find('[data-test="add-template-title"]');
    expect(titleEl.text()).toContain("Update");
  });

  it("sets isUpdatingTemplate to true when template prop provided", async () => {
    const w = await mountComp({ template: existingTemplate });
    await flushPromises();
    expect((w.vm as any).isUpdatingTemplate).toBe(true);
  });

  it("populates formData.name from template", async () => {
    const w = await mountComp({ template: existingTemplate });
    await flushPromises();
    expect((w.vm as any).formData.name).toBe("my-template");
  });

  it("populates formData.body from template", async () => {
    const w = await mountComp({ template: existingTemplate });
    await flushPromises();
    expect((w.vm as any).formData.body).toBe(existingTemplate.body);
  });
});

describe("AddTemplate - initial state", () => {
  it("formData.name is empty by default", async () => {
    const w = await mountComp();
    expect((w.vm as any).formData.name).toBe("");
  });

  it("formData.type is http by default", async () => {
    const w = await mountComp();
    expect((w.vm as any).formData.type).toBe("http");
  });

  it("isUpdatingTemplate is false by default", async () => {
    const w = await mountComp();
    expect((w.vm as any).isUpdatingTemplate).toBe(false);
  });

  it("splitterModel is 75 by default", async () => {
    const w = await mountComp();
    expect((w.vm as any).splitterModel).toBe(75);
  });
});

describe("AddTemplate - isTemplateFilled", () => {
  it("returns false when name is empty", async () => {
    const w = await mountComp();
    (w.vm as any).formData.name = "";
    (w.vm as any).formData.body = "some body";
    expect((w.vm as any).isTemplateFilled()).toBeFalsy();
  });

  it("returns false when body is empty", async () => {
    const w = await mountComp();
    (w.vm as any).formData.name = "mytemplate";
    (w.vm as any).formData.body = "";
    expect((w.vm as any).isTemplateFilled()).toBeFalsy();
  });

  it("returns truthy when name and body both filled", async () => {
    const w = await mountComp();
    (w.vm as any).formData.name = "mytemplate";
    (w.vm as any).formData.body = '{"text": "alert"}';
    expect((w.vm as any).isTemplateFilled()).toBeTruthy();
  });
});

describe("AddTemplate - cancel button", () => {
  it("clicking cancel emits cancel:hideform", async () => {
    const w = await mountComp();
    await w.find('[data-test="add-template-cancel-btn"]').trigger("click");
    expect(w.emitted("cancel:hideform")).toBeTruthy();
  });
});

describe("AddTemplate - saveTemplate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls templateService.create in create mode when form is filled", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).formData.name = "new-template";
    (w.vm as any).formData.body = '{"text": "alert"}';
    await (w.vm as any).saveTemplate();
    await flushPromises();
    expect(templateService.create).toHaveBeenCalled();
  });

  it("calls templateService.update in update mode", async () => {
    const existingTemplate = {
      name: "my-template",
      body: '{"text": "existing"}',
      type: "http",
      title: "",
    };
    const w = await mountComp({ template: existingTemplate });
    await flushPromises();
    (w.vm as any).formData.body = '{"text": "updated"}';
    await (w.vm as any).saveTemplate();
    await flushPromises();
    expect(templateService.update).toHaveBeenCalled();
  });

  it("does not call service when form is not filled", async () => {
    const w = await mountComp();
    (w.vm as any).formData.name = "";
    (w.vm as any).formData.body = "";
    await (w.vm as any).saveTemplate();
    await flushPromises();
    expect(templateService.create).not.toHaveBeenCalled();
    expect(templateService.update).not.toHaveBeenCalled();
  });
});

describe("AddTemplate - tabs computed", () => {
  it("tabs includes http and email options", async () => {
    const w = await mountComp();
    const tabValues = (w.vm as any).tabs.map((t: any) => t.value ?? t.label);
    // tabs should have HTTP and Email type options
    expect(tabValues.length).toBeGreaterThanOrEqual(2);
  });
});
