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
// The item navigator has to let a reviewer tell items apart before opening
// them. A bare target id cannot do that, so each entry leads with the stored
// first-user-turn preview and demotes the id to secondary text; an item whose
// trace carried no recognizable input keeps the id as its only label.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const mockGetQueue = vi.fn();
const mockListItems = vi.fn();
const mockListScoreConfigs = vi.fn();
const mockGetItemDetail = vi.fn();

vi.mock("@/services/llm-queues.service", () => ({
  default: {
    get: (...args: any[]) => mockGetQueue(...args),
    listItems: (...args: any[]) => mockListItems(...args),
    listScoreConfigOptions: (...args: any[]) => mockListScoreConfigs(...args),
    getItemDetail: (...args: any[]) => mockGetItemDetail(...args),
    listReviews: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/services/llm-datasets.service", () => ({ default: { list: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({ state: { selectedOrganization: { identifier: "test-org" } } })),
}));

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  useRoute: vi.fn(() => ({ params: { id: "q1" }, query: {} })),
}));

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

vi.mock("@/lib/core/PageLayout/OPageLayout.vue", () => ({
  default: { name: "OPageLayout", template: `<div><slot /></div>` },
}));

import QueueWorkbenchPage from "./QueueWorkbenchPage.vue";

function item(overrides: Record<string, unknown>) {
  return {
    id: "item",
    queueId: "q1",
    queueName: "Helpfulness review",
    refType: "trace",
    refId: "01a0af9a082773719d708c1a8f000000",
    refTraceId: null,
    refTraceStartTime: 1_700_000_000_000_000,
    inputPreview: null,
    status: "pending",
    reviewedAt: null,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function mountPage() {
  const wrapper = mount(QueueWorkbenchPage, {
    global: {
      stubs: {
        OTabs: { template: `<div><slot /></div>` },
        OTab: { template: `<div class="o-tab"><slot /></div>` },
        OButton: true,
        OIcon: true,
        OTag: true,
        OSpinner: true,
        OProgressBar: true,
        OSlider: true,
        ORadioGroup: true,
        ORadio: true,
        OTextarea: true,
        OTagInput: true,
        OSelect: true,
        OTooltip: true,
        ODrawer: true,
        ReviewContentBox: true,
        "i18n-t": true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  mockGetQueue.mockReset().mockResolvedValue({
    id: "q1",
    name: "Helpfulness review",
    scoreConfigs: [],
    targetDatasetId: null,
  });
  mockListScoreConfigs.mockReset().mockResolvedValue([]);
  mockListItems.mockReset();
  mockGetItemDetail.mockReset().mockRejectedValue(new Error("no detail"));
});

describe("QueueWorkbenchPage item navigator", () => {
  it("leads with the input preview and demotes the target id", async () => {
    mockListItems.mockResolvedValue([
      item({ id: "a", refId: "trace-a", inputPreview: "How do I rotate keys?" }),
      item({ id: "b", refId: "trace-b", inputPreview: "Why is the chart flat?" }),
    ]);
    const wrapper = await mountPage();

    const first = wrapper.find('[data-test="ai-queue-workbench-nav-item-0"]');
    expect(first.find('[data-test="ai-queue-workbench-nav-preview-0"]').text()).toBe(
      "How do I rotate keys?",
    );
    expect(first.text()).toContain("trace-a");
    expect(wrapper.find('[data-test="ai-queue-workbench-nav-preview-1"]').text()).toBe(
      "Why is the chart flat?",
    );
  });

  it("falls back to the target id when no preview was captured", async () => {
    mockListItems.mockResolvedValue([item({ id: "a", refId: "trace-a", inputPreview: null })]);
    const wrapper = await mountPage();

    const first = wrapper.find('[data-test="ai-queue-workbench-nav-item-0"]');
    expect(first.find('[data-test="ai-queue-workbench-nav-preview-0"]').exists()).toBe(false);
    expect(first.text()).toContain("trace-a");
  });

  it("adopts the preview the detail endpoint backfills for an older item", async () => {
    const older = item({ id: "a", refId: "trace-a", inputPreview: null });
    mockListItems.mockResolvedValue([older]);
    mockGetItemDetail.mockResolvedValue({
      item: { ...older, inputPreview: "Why is the chart flat?" },
      sourceStream: "traces",
      content: { input: null, output: null, trace: [] },
      machineScores: [],
      reviews: [],
    });
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="ai-queue-workbench-nav-preview-0"]').text()).toBe(
      "Why is the chart flat?",
    );
  });
});
