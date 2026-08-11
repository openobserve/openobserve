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
// The detail page is a pointer list: it shows only what the queue-item API
// carries, derives the status counts client-side, and hands a specific item to
// the Workbench. These pin those three things.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetQueue = vi.fn();
const mockListItems = vi.fn();
const mockToast = vi.fn();
const mockPush = vi.fn();

vi.mock("@/services/llm-queues.service", () => ({
  default: {
    get: (...args: any[]) => mockGetQueue(...args),
    listItems: (...args: any[]) => mockListItems(...args),
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({ state: { selectedOrganization: { identifier: "test-org" } } })),
}));

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
  useRoute: vi.fn(() => ({ params: { id: "q1" }, query: {} })),
}));

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

vi.mock("@/lib/core/PageLayout/OPageLayout.vue", () => ({
  default: {
    name: "OPageLayout",
    template: `<div class="o-page-layout"><slot name="actions" /><slot name="subnav" /><slot /></div>`,
  },
}));

vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    props: ["data", "columns"],
    emits: ["rowClick"],
    template: `<div class="o-table" :data-rows="(data || []).map(r => r.id).join(',')">
      <slot name="subheader" />
      <template v-for="row in data" :key="row.id"><slot name="cell-actions" :row="row" /></template>
    </div>`,
  },
}));

vi.mock("@/lib/data/StatStrip/OStatStrip.vue", () => ({
  default: {
    name: "OStatStrip",
    props: ["items", "selectedKey"],
    emits: ["select"],
    template: `<div class="o-stat-strip" :data-selected="selectedKey"
      :data-stats="(items || []).map(i => i.key + ':' + i.value).join(',')" />`,
  },
}));

import { mount, flushPromises } from "@vue/test-utils";
import QueueDetailPage from "./QueueDetailPage.vue";

const QUEUE = {
  id: "q1",
  name: "Hallucination triage",
  description: "Faithfulness failures",
  targetDatasetId: "d1",
  targetDatasetName: "Hallucination goldens",
  allowedRefTypes: ["trace"],
  scoreConfigs: [{ scoreConfigId: "s1", name: "faithfulness", version: 2, dataType: "numeric" }],
  reviewedCount: 1,
  totalCount: 3,
};

const ITEMS = [
  { id: "i1", refType: "trace", refId: "trace-1", refTraceId: null, status: "pending" },
  { id: "i2", refType: "span", refId: "span-1", refTraceId: "trace-2", status: "reviewed" },
  { id: "i3", refType: "trace", refId: "trace-3", refTraceId: null, status: "pending" },
];

async function mountPage() {
  const wrapper = mount(QueueDetailPage);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  mockGetQueue.mockReset().mockResolvedValue(QUEUE);
  mockListItems.mockReset().mockResolvedValue(ITEMS);
  mockToast.mockReset();
  mockPush.mockReset();
});

describe("QueueDetailPage", () => {
  it("loads the queue and its items, and derives the status counts", async () => {
    const wrapper = await mountPage();

    expect(mockGetQueue).toHaveBeenCalledWith("test-org", "q1");
    expect(mockListItems).toHaveBeenCalledWith("test-org", "q1");
    expect(wrapper.find(".o-stat-strip").attributes("data-stats")).toBe(
      "pending:2,reviewed:1,all:3",
    );
  });

  it("filters the table to one status when a tile is picked, and toggles back", async () => {
    const wrapper = await mountPage();
    const strip = wrapper.findComponent({ name: "OStatStrip" });

    strip.vm.$emit("select", "reviewed");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".o-table").attributes("data-rows")).toBe("i2");

    strip.vm.$emit("select", "reviewed");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".o-table").attributes("data-rows")).toBe("i1,i2,i3");
  });

  it("opens the Workbench on the clicked item, and without one from the header action", async () => {
    const wrapper = await mountPage();

    await wrapper.find('[data-test="ai-queue-detail-review-i3"]').trigger("click");
    expect(mockPush).toHaveBeenCalledWith({
      name: "aiQueueWorkbench",
      params: { id: "q1" },
      query: { org_identifier: "test-org", item: "i3" },
    });

    mockPush.mockReset();
    await wrapper.find('[data-test="ai-queue-detail-start-review"]').trigger("click");
    expect(mockPush).toHaveBeenCalledWith({
      name: "aiQueueWorkbench",
      params: { id: "q1" },
      query: { org_identifier: "test-org" },
    });
  });

  it("reports a failed load", async () => {
    mockGetQueue.mockRejectedValueOnce(new Error("nope"));
    await mountPage();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });
});
