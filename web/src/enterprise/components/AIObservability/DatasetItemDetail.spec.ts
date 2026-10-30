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
// The item detail exists for two things the table can't show: the MVCC version
// history, and the lineage pointers back to where the golden came from. Those,
// plus the one-overlay-at-a-time contract with the edit form, are what's pinned.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetItemVersions = vi.fn();
const mockToast = vi.fn();

vi.mock("@/services/llm-datasets.service", () => ({
  default: { getItemVersions: (...args: any[]) => mockGetItemVersions(...args) },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({ state: { selectedOrganization: { identifier: "test-org" } } })),
}));

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

vi.mock("@/lib/overlay/Drawer/ODrawer.vue", () => ({
  default: {
    name: "ODrawer",
    props: ["open", "title", "subTitle"],
    emits: ["update:open"],
    template: `<div class="o-drawer" :data-open="open" :data-title="title">
      <slot /><slot name="footer" /></div>`,
  },
}));

vi.mock("@/lib/core/Code/OCode.vue", () => ({
  default: { name: "OCode", template: `<code class="o-code"><slot /></code>` },
}));

import { mount, flushPromises } from "@vue/test-utils";
import DatasetItemDetail from "./DatasetItemDetail.vue";

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    rowId: "row-2",
    datasetId: "dataset-1",
    input: '[{"role":"user","content":"why was my refund declined?"}]',
    inputPreview: "why was my refund declined?",
    expectedOutput: "Beyond 30 days needs manual review.",
    rawInput: null,
    rawExpectedOutput: null,
    source: "annotation" as const,
    tags: ["refund"],
    version: 2,
    metadata: { difficulty: "easy" },
    sourceRef: "trace-48",
    sourceSpanId: "span-9",
    reviewSubmissionId: "sub-3",
    importFilename: null,
    isDeleted: false,
    updatedBy: "sam@openobserve.ai",
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function mountDetail(overrides: Record<string, unknown> = {}) {
  return mount(DatasetItemDetail, {
    props: { item: item(overrides) as any, datasetId: "dataset-1" },
    global: {
      stubs: { OTabs: true, OTab: true, OTag: true, OEmptyState: true, OButton: true },
    },
  });
}

beforeEach(() => {
  mockGetItemVersions.mockReset().mockResolvedValue([]);
  mockToast.mockReset();
});

describe("DatasetItemDetail", () => {
  it("loads every version of the LOGICAL item on open", async () => {
    mountDetail();
    await flushPromises();

    expect(mockGetItemVersions).toHaveBeenCalledWith("test-org", "dataset-1", "item-1");
  });

  it("orders versions newest first, whatever order the API returned them in", async () => {
    mockGetItemVersions.mockResolvedValue([
      item({ rowId: "row-1", version: 1 }),
      item({ rowId: "row-3", version: 3 }),
      item({ rowId: "row-2", version: 2 }),
    ]);
    const wrapper = mountDetail();
    await flushPromises();

    expect((wrapper.vm as any).$.setupState.versions.map((v: any) => v.version)).toEqual([3, 2, 1]);
  });

  // An annotation push writes BOTH a trace ref and a review submission — the
  // detail lists each pointer rather than collapsing them into one line.
  it("lists every lineage pointer the item carries", async () => {
    const wrapper = mountDetail();
    await flushPromises();

    expect((wrapper.vm as any).$.setupState.lineage.map((r: any) => r.key)).toEqual([
      "trace",
      "span",
      "review",
    ]);
  });

  it("shows no source section for a hand-written golden", async () => {
    const wrapper = mountDetail({
      source: "manual",
      sourceRef: null,
      sourceSpanId: null,
      reviewSubmissionId: null,
    });
    await flushPromises();

    expect((wrapper.vm as any).$.setupState.lineage).toEqual([]);
    expect(wrapper.find('[data-test="ai-dataset-item-detail-source-section"]').exists()).toBe(
      false,
    );
  });

  it("pretty-prints metadata, and renders nothing when there is none", async () => {
    const withMeta = mountDetail();
    await flushPromises();
    expect((withMeta.vm as any).$.setupState.metadataJson).toBe('{\n  "difficulty": "easy"\n}');

    const without = mountDetail({ metadata: null });
    await flushPromises();
    expect((without.vm as any).$.setupState.metadataJson).toBe("");
  });

  it("emits edit and delete for the parent to act on, without closing itself", async () => {
    const wrapper = mountDetail();
    await flushPromises();
    const row = wrapper.props("item");

    (wrapper.vm as any).$.setupState.emit("edit", row);
    (wrapper.vm as any).$.setupState.emit("delete", row);

    expect(wrapper.emitted("edit")?.[0]).toEqual([row]);
    expect(wrapper.emitted("delete")?.[0]).toEqual([row]);
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("closes through the drawer's own dismiss paths", async () => {
    const wrapper = mountDetail();
    await flushPromises();

    await wrapper.findComponent({ name: "ODrawer" }).vm.$emit("update:open", false);

    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("surfaces a version-history failure as an error toast", async () => {
    mockGetItemVersions.mockRejectedValueOnce(new Error("boom"));
    mountDetail();
    await flushPromises();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });
});
