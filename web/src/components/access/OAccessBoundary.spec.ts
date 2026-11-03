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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { computed, defineComponent, h, ref, shallowRef } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import OAccessBoundary from "@/components/access/OAccessBoundary.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { viewDenial, type AccessSectionEntry } from "@/composables/useAccessStore";

const state = vi.hoisted(() => ({ entries: [] as AccessSectionEntry[] }));

vi.mock("@/composables/useAccessStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useAccessStore")>();
  return {
    ...actual,
    useAccessBoundary: () => ({
      pageDenied: computed(() => false),
      pageDenial: computed(() => null),
      pageRequests: () => [],
      sectionEntries: computed(() => state.entries),
      deepestBoundary: computed(() => -1),
      actionNotice: shallowRef(null),
      dismissAction: vi.fn(),
    }),
  };
});

let wrapper: VueWrapper | null = null;

async function mountTable(entries: AccessSectionEntry[], forbiddenResource?: string) {
  state.entries = entries;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { render: () => null } }],
  });
  await router.push("/");
  const Page = defineComponent({
    setup: () => () =>
      h(OTable, {
        data: [],
        columns: [{ id: "name", header: "Name", accessorKey: "name" }],
        forbidden: true,
        forbiddenResource,
        loading: ref(false).value,
      }),
  });
  wrapper = mount(OAccessBoundary, {
    slots: { default: () => h(Page) },
    global: { plugins: [i18n, router] },
  });
  await flushPromises();
  return wrapper.get('[data-test="o2-table-forbidden"]');
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("OAccessBoundary table no-access state", () => {
  it("shows the shared lock naming the table's refused list", async () => {
    const forbidden = await mountTable(
      [
        viewDenial("templates", "list", ["GET /api/default/alerts/templates"]),
        viewDenial("alert_folders", "list", ["GET /api/v2/default/alerts"]),
      ],
      "alert_folders",
    );
    expect(forbidden.find('[data-test="access-lock-icon"]').exists()).toBe(true);
    expect(forbidden.text()).toContain("You can't view alert folders");
    expect(forbidden.text()).toContain(
      "Your role is missing the List permission on Alert folders.",
    );
    expect(forbidden.text()).toContain("Copy details");
  });

  it("keeps the shared lock with the general wording when it cannot tell which list was refused", async () => {
    const forbidden = await mountTable([
      viewDenial("templates", "list"),
      viewDenial("destinations", "list"),
    ]);
    expect(forbidden.find('[data-test="access-lock-icon"]').exists()).toBe(true);
    expect(forbidden.text()).toContain("You don't have access");
    expect(forbidden.text()).not.toContain("Copy details");
  });

  it("does not name the page's only refused list on a table that names no resource", async () => {
    const forbidden = await mountTable([viewDenial("templates", "list")]);
    expect(forbidden.text()).toContain("You don't have access");
    expect(forbidden.text()).not.toContain("templates");
  });
});
