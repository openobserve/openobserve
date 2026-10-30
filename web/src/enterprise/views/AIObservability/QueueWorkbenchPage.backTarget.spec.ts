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
// Review can be started from two places: the Queues LIST (one click, skipping
// the detail page) and the queue DETAIL. Back has to return to whichever one
// the reviewer actually came from — sending them to a page they never opened is
// a detour, so the entry point travels in `?from=`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const mockGetQueue = vi.fn();
const mockListItems = vi.fn();
const mockListScoreConfigs = vi.fn();
const routeQuery: Record<string, string> = {};

vi.mock("@/services/llm-queues.service", () => ({
  default: {
    get: (...args: any[]) => mockGetQueue(...args),
    listItems: (...args: any[]) => mockListItems(...args),
    listScoreConfigOptions: (...args: any[]) => mockListScoreConfigs(...args),
    getItemDetail: vi.fn().mockResolvedValue(null),
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
  useRoute: vi.fn(() => ({ params: { id: "q1" }, query: routeQuery })),
}));

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

vi.mock("@/lib/core/PageLayout/OPageLayout.vue", () => ({
  default: {
    name: "OPageLayout",
    props: ["back"],
    template: `<div class="o-page-layout" :data-back-name="back?.to?.name" :data-back-label="back?.label"><slot /></div>`,
  },
}));

import QueueWorkbenchPage from "./QueueWorkbenchPage.vue";

async function mountPage(from?: string) {
  for (const key of Object.keys(routeQuery)) delete routeQuery[key];
  if (from) routeQuery.from = from;
  const wrapper = mount(QueueWorkbenchPage, {
    global: {
      stubs: {
        OTabs: true,
        OTab: true,
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
    name: "Safety review",
    scoreConfigs: [],
    targetDatasetId: null,
  });
  mockListItems.mockReset().mockResolvedValue([]);
  mockListScoreConfigs.mockReset().mockResolvedValue([]);
});

describe("QueueWorkbenchPage back target", () => {
  it("returns to the Queues list when review started there", async () => {
    const wrapper = await mountPage("queues");
    const layout = wrapper.find(".o-page-layout");

    expect(layout.attributes("data-back-name")).toBe("aiQueues");
    expect(layout.attributes("data-back-label")).toBe("aiObservability.nav.queues");
  });

  it("returns to the queue detail when review started there", async () => {
    const wrapper = await mountPage();

    expect(wrapper.find(".o-page-layout").attributes("data-back-name")).toBe("aiQueueDetail");
  });

  it("falls back to the queue detail for an unknown entry point (e.g. a deep link)", async () => {
    const wrapper = await mountPage("somewhere-else");

    expect(wrapper.find(".o-page-layout").attributes("data-back-name")).toBe("aiQueueDetail");
  });
});
