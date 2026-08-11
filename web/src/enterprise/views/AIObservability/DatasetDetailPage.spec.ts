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
//
// @vitest-environment jsdom
//
// Items are MVCC and the update endpoint replaces the whole row, so the write
// path is where this page can lose data silently. These pin what an edit must
// carry through, and the one-overlay-at-a-time rule between the detail drawer
// and the edit form.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();
const mockListItems = vi.fn();
const mockUpdateItem = vi.fn();
const mockAddItem = vi.fn();
const mockRemoveItem = vi.fn();
const mockToast = vi.fn();
const mockConfirm = vi.fn();

vi.mock("@/services/llm-datasets.service", () => ({
  default: {
    get: (...args: any[]) => mockGet(...args),
    listItems: (...args: any[]) => mockListItems(...args),
    updateItem: (...args: any[]) => mockUpdateItem(...args),
    addItem: (...args: any[]) => mockAddItem(...args),
    removeItem: (...args: any[]) => mockRemoveItem(...args),
  },
  DATASET_ITEMS_MAX_PAGE_SIZE: 100,
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: (...args: any[]) => mockConfirm(...args) }),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({ state: { selectedOrganization: { identifier: "test-org" } } })),
}));

vi.mock("vue-router", () => ({
  useRoute: vi.fn(() => ({ params: { id: "dataset-1" } })),
}));

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

vi.mock("@/lib/core/PageLayout/OPageLayout.vue", () => ({
  default: {
    name: "OPageLayout",
    template: `<div class="o-page-layout"><slot name="actions" /><slot /></div>`,
  },
}));

vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    props: ["data", "columns", "loading"],
    emits: ["update:currentPage", "update:pageSize", "rowClick"],
    template: `<div class="o-table" :data-rows="(data || []).length" />`,
  },
}));

vi.mock("@/enterprise/components/AIObservability/DatasetItemDetail.vue", () => ({
  default: {
    name: "DatasetItemDetail",
    props: ["item", "datasetId"],
    emits: ["close", "edit", "delete"],
    template: `<div class="item-detail" :data-item="item.id" />`,
  },
}));

import { mount, flushPromises } from "@vue/test-utils";
import DatasetDetailPage from "./DatasetDetailPage.vue";

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    rowId: "row-2",
    datasetId: "dataset-1",
    input: "why was my refund declined?",
    inputPreview: "why was my refund declined?",
    expectedOutput: "Beyond 30 days needs manual review.",
    rawInput: [{ role: "user", content: "why was my refund declined?" }],
    rawExpectedOutput: "Beyond 30 days needs manual review.",
    source: "annotation",
    tags: ["refund"],
    version: 2,
    metadata: { difficulty: "easy" },
    sourceRef: "trace-48",
    sourceSpanId: "span-9",
    reviewSubmissionId: null,
    importFilename: null,
    isDeleted: false,
    ...overrides,
  };
}

async function mountPage() {
  const wrapper = mount(DatasetDetailPage, {
    global: {
      stubs: {
        OButton: true,
        OTag: true,
        OTooltip: true,
        OSearchInput: true,
        OEmptyState: true,
        ODrawer: true,
        OForm: true,
        OFormTextarea: true,
        OFormTagInput: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue({ id: "dataset-1", name: "RAG regression set" });
  mockListItems
    .mockReset()
    .mockResolvedValue({ items: [item()], total: 1, from: 0, size: 20, hasMore: false });
  mockUpdateItem.mockReset().mockResolvedValue(item({ version: 3 }));
  mockAddItem.mockReset().mockResolvedValue(item());
  mockRemoveItem.mockReset().mockResolvedValue(undefined);
  mockToast.mockReset();
  mockConfirm.mockReset().mockResolvedValue(true);
});

describe("DatasetDetailPage item writes", () => {
  // The update endpoint replaces the row, so an edit that omits metadata wipes
  // the item's subset-filter dimensions.
  it("re-sends the item's metadata when only the answer changed", async () => {
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;

    state.openEditItem(state.items[0]);
    await state.saveItem({
      input: state.items[0].input,
      expectedOutput: "a better answer",
      tags: ["refund"],
    });
    await flushPromises();

    expect(mockUpdateItem).toHaveBeenCalledWith("test-org", "dataset-1", "item-1", {
      // Untouched input goes back as the ORIGINAL structured value.
      input: state.items[0].rawInput,
      expectedOutput: "a better answer",
      metadata: { difficulty: "easy" },
      tags: ["refund"],
    });
  });

  it("sends no metadata when adding a brand-new item", async () => {
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;

    state.openAddItem();
    await state.saveItem({ input: "q", expectedOutput: "a", tags: [] });
    await flushPromises();

    expect(mockAddItem).toHaveBeenCalledWith("test-org", "dataset-1", {
      input: "q",
      expectedOutput: "a",
      metadata: null,
      tags: [],
    });
  });
});

describe("DatasetDetailPage item detail", () => {
  it("opens the detail drawer for a clicked row", async () => {
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;

    state.openItemDetail(state.items[0]);
    await flushPromises();

    expect(wrapper.find(".item-detail").attributes("data-item")).toBe("item-1");
  });

  // Only one overlay at a time — editing from the detail closes it and opens
  // the form, so the two drawers never stack.
  it("swaps the detail for the edit form", async () => {
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;

    state.openItemDetail(state.items[0]);
    state.editFromDetail(state.items[0]);
    await flushPromises();

    expect(wrapper.find(".item-detail").exists()).toBe(false);
    expect(state.itemOpen).toBe(true);
    expect(state.editingItemId).toBe("item-1");
  });

  it("closes the detail once its item is deleted", async () => {
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;

    state.openItemDetail(state.items[0]);
    await state.deleteFromDetail(state.items[0]);
    await flushPromises();

    expect(mockRemoveItem).toHaveBeenCalledWith("test-org", "dataset-1", "item-1");
    expect(wrapper.find(".item-detail").exists()).toBe(false);
  });

  it("leaves the detail open when the delete is cancelled", async () => {
    mockConfirm.mockResolvedValue(false);
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;

    state.openItemDetail(state.items[0]);
    await state.deleteFromDetail(state.items[0]);
    await flushPromises();

    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(wrapper.find(".item-detail").exists()).toBe(true);
  });
});
