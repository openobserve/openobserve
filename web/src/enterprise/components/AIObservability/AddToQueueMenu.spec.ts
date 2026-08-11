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
// The menu is a structured list, not a bare one: a named "Add To Queue" section
// over the queues, and a Manage Queues way out. These pin that structure and the
// eligibility rule the section still enforces.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

// Reka UI portals menu content into <body>; render it inline instead.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return { ...actual, DropdownMenuPortal: actual.DropdownMenuContent };
});

const mockPush = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mockPush }) }));

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "test-org" } } }),
}));

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

import AddToQueueMenu from "./AddToQueueMenu.vue";

const QUEUES = [
  { id: "q1", name: "Hallucination triage", allowedRefTypes: ["trace"], scoreConfigs: [{}, {}] },
  { id: "q2", name: "Span safety", allowedRefTypes: ["span"], scoreConfigs: [{}] },
];

async function mountOpen(props: Record<string, unknown> = {}) {
  const wrapper = mount(AddToQueueMenu, {
    props: { scope: "trace", queues: QUEUES, label: "Add To Queue", ...props } as any,
  });
  (wrapper.vm as any).$.setupState.open = true;
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(() => mockPush.mockReset());

describe("AddToQueueMenu", () => {
  it("groups the queues under an Add To Queue section header", async () => {
    const wrapper = await mountOpen();

    expect(wrapper.text()).toContain("aiObservability.discovery.addToQueueMenu.sectionTitle");
    expect(wrapper.find('[data-test="add-to-queue-menu-item-q1"]').exists()).toBe(true);
  });

  it("offers Manage Queues, which leaves for the Queues page and closes the menu", async () => {
    const wrapper = await mountOpen();

    const manage = wrapper.find('[data-test="add-to-queue-menu-manage"]');
    expect(manage.exists()).toBe(true);

    await manage.trigger("click");

    expect(mockPush).toHaveBeenCalledWith({
      name: "aiQueues",
      query: { org_identifier: "test-org" },
    });
    expect((wrapper.vm as any).$.setupState.open).toBe(false);
  });

  it("keeps a queue that rejects the scope visible but disabled", async () => {
    const wrapper = await mountOpen();

    const ineligible = wrapper.find('[data-test="add-to-queue-menu-item-q2"]');
    expect(ineligible.attributes("data-disabled")).toBeDefined();

    await wrapper.find('[data-test="add-to-queue-menu-item-q1"]').trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual([QUEUES[0]]);
  });

  it("shows the loading and empty notes inside the section", async () => {
    const loading = await mountOpen({ queues: [], loading: true });
    expect(loading.find('[data-test="add-to-queue-menu-loading"]').exists()).toBe(true);

    const empty = await mountOpen({ queues: [] });
    expect(empty.find('[data-test="add-to-queue-menu-empty"]').exists()).toBe(true);
  });
});
