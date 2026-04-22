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

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ params: {}, query: {} }),
}));

vi.mock("@/services/eval-template.service", () => ({
  evalTemplateService: {
    listTemplates: vi.fn(),
    deleteTemplate: vi.fn(),
  },
}));

import EvalTemplateList from "@/enterprise/components/EvalTemplateList.vue";
import { evalTemplateService } from "@/services/eval-template.service";

// ── Helpers ────────────────────────────────────────────────────────────────────

interface Template {
  id: string;
  name: string;
  response_type: string;
  description?: string;
  content: string;
  dimensions: string[];
  version: number;
  created_at: number;
  updated_at: number;
}

const makeTemplate = (idx: number, overrides: Partial<Template> = {}): Template => ({
  id: `tmpl-${idx}`,
  name: overrides.name ?? `Template ${idx}`,
  response_type: overrides.response_type ?? "score",
  description: "",
  content: `Evaluate {{input}} for quality.`,
  dimensions: ["accuracy", "relevance"],
  version: 1,
  created_at: Date.now(),
  updated_at: Date.now(),
  ...overrides,
});

let templatesDB: Template[] = [];

async function mountList() {
  return mount(EvalTemplateList, {
    global: {
      plugins: [i18n, store],
      stubs: {
        QTablePagination: true,
        NoData: true,
        ConfirmDialog: true,
      },
    },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("EvalTemplateList - rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    templatesDB = [
      makeTemplate(1, { name: "Accuracy Check", response_type: "score" }),
      makeTemplate(2, { name: "Toxicity Filter", response_type: "boolean" }),
      makeTemplate(3, { name: "Custom Eval", response_type: "custom" }),
    ];
    vi.mocked(evalTemplateService.listTemplates).mockResolvedValue(templatesDB as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the list page container", async () => {
    const wrapper = await mountList();
    expect(wrapper.find('[data-test="eval-template-list-page"]').exists()).toBe(true);
  });

  it("renders the page title", async () => {
    const wrapper = await mountList();
    expect(wrapper.find('[data-test="eval-template-list-title"]').exists()).toBe(true);
  });

  it("renders search input", async () => {
    const wrapper = await mountList();
    expect(wrapper.find('[data-test="eval-template-list-search-input"]').exists()).toBe(true);
  });

  it("renders refresh button", async () => {
    const wrapper = await mountList();
    expect(wrapper.find('[data-test="eval-template-list-refresh-btn"]').exists()).toBe(true);
  });

  it("renders add button", async () => {
    const wrapper = await mountList();
    expect(wrapper.find('[data-test="eval-template-list-add-btn"]').exists()).toBe(true);
  });

  it("renders the table", async () => {
    const wrapper = await mountList();
    expect(wrapper.find('[data-test="eval-template-list-table"]').exists()).toBe(true);
  });
});

describe("EvalTemplateList - data loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    templatesDB = [
      makeTemplate(1, { name: "Accuracy Check" }),
      makeTemplate(2, { name: "Toxicity Filter" }),
    ];
    vi.mocked(evalTemplateService.listTemplates).mockResolvedValue(templatesDB as any);
  });

  afterEach(() => vi.restoreAllMocks());

  it("calls listTemplates on mount", async () => {
    await mountList();
    await flushPromises();
    expect(evalTemplateService.listTemplates).toHaveBeenCalledOnce();
  });

  it("populates rows after loading", async () => {
    const wrapper: any = await mountList();
    await flushPromises();
    expect(wrapper.vm.rows.length).toBe(templatesDB.length);
  });

  it("sets resultTotal to number of loaded templates", async () => {
    const wrapper: any = await mountList();
    await flushPromises();
    expect(wrapper.vm.resultTotal).toBe(templatesDB.length);
  });

  it("sets isLoading to false after load completes", async () => {
    const wrapper: any = await mountList();
    await flushPromises();
    expect(wrapper.vm.isLoading).toBe(false);
  });

  it("calls listTemplates again when refresh button is clicked", async () => {
    const wrapper: any = await mountList();
    await flushPromises();
    await wrapper.find('[data-test="eval-template-list-refresh-btn"]').trigger("click");
    await flushPromises();
    expect(evalTemplateService.listTemplates).toHaveBeenCalledTimes(2);
  });
});

describe("EvalTemplateList - filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    templatesDB = [
      makeTemplate(1, { name: "Accuracy Check" }),
      makeTemplate(2, { name: "Toxicity Filter" }),
      makeTemplate(3, { name: "Accuracy Score" }),
    ];
    vi.mocked(evalTemplateService.listTemplates).mockResolvedValue(templatesDB as any);
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns all rows when filterQuery is empty", async () => {
    const wrapper: any = await mountList();
    await flushPromises();
    expect(wrapper.vm.visibleRows.length).toBe(3);
  });

  it("filters rows by name when filterQuery is set", async () => {
    const wrapper: any = await mountList();
    await flushPromises();
    wrapper.vm.filterQuery = "accuracy";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.visibleRows.every((r: any) =>
      r.name.toLowerCase().includes("accuracy"),
    )).toBe(true);
  });

  it("returns empty array when filterQuery matches nothing", async () => {
    const wrapper: any = await mountList();
    await flushPromises();
    wrapper.vm.filterQuery = "zzznomatch";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.visibleRows.length).toBe(0);
  });

  it("updates resultTotal to reflect filtered count", async () => {
    const wrapper: any = await mountList();
    await flushPromises();
    wrapper.vm.filterQuery = "accuracy";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.resultTotal).toBe(2);
  });
});

describe("EvalTemplateList - navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(evalTemplateService.listTemplates).mockResolvedValue([]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("navigates to create page when add button is clicked", async () => {
    const wrapper = await mountList();
    await wrapper.find('[data-test="eval-template-list-add-btn"]').trigger("click");
    expect(mockPush).toHaveBeenCalledWith({ name: "evalTemplatesAdd" });
  });

  it("navigates to edit page when goToEdit is called", async () => {
    const wrapper: any = await mountList();
    const template = makeTemplate(1);
    wrapper.vm.goToEdit(template);
    expect(mockPush).toHaveBeenCalledWith({
      name: "evalTemplatesEdit",
      params: { id: template.id },
    });
  });
});

describe("EvalTemplateList - delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    templatesDB = [makeTemplate(1, { name: "To Delete" }), makeTemplate(2)];
    vi.mocked(evalTemplateService.listTemplates).mockResolvedValue(templatesDB as any);
    vi.mocked(evalTemplateService.deleteTemplate).mockResolvedValue(undefined as any);
  });

  afterEach(() => vi.restoreAllMocks());

  it("opens delete dialog when confirmDelete is called", async () => {
    const wrapper: any = await mountList();
    const template = templatesDB[0];
    wrapper.vm.confirmDelete(template);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.deleteDialog.show).toBe(true);
    expect(wrapper.vm.deleteDialog.data).toEqual(template);
  });

  it("calls deleteTemplate and reloads on deleteTemplate confirm", async () => {
    const wrapper: any = await mountList();
    await flushPromises();
    const template = templatesDB[0];
    wrapper.vm.deleteDialog.data = template;
    await wrapper.vm.deleteTemplate();
    await flushPromises();
    expect(evalTemplateService.deleteTemplate).toHaveBeenCalledWith(
      expect.any(String),
      template.id,
    );
    expect(evalTemplateService.listTemplates).toHaveBeenCalledTimes(2);
  });

  it("closes dialog after deletion", async () => {
    const wrapper: any = await mountList();
    await flushPromises();
    wrapper.vm.deleteDialog.data = templatesDB[0];
    await wrapper.vm.deleteTemplate();
    await flushPromises();
    expect(wrapper.vm.deleteDialog.show).toBe(false);
  });

  it("bulk delete calls deleteTemplate for each selected item", async () => {
    const wrapper: any = await mountList();
    await flushPromises();
    wrapper.vm.selectedItems = [templatesDB[0], templatesDB[1]];
    await wrapper.vm.bulkDeleteTemplates();
    await flushPromises();
    expect(evalTemplateService.deleteTemplate).toHaveBeenCalledTimes(2);
  });
});
