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

import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/locales";

const fake = vi.hoisted(() => ({ mounts: 0, refreshes: 0, org: "org" as string | undefined }));

vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuex")>()),
  useStore: () => ({
    state: { selectedOrganization: fake.org ? { identifier: fake.org } : null },
  }),
}));
vi.mock("@/components/starterPacks/StarterPackLibraryTab.vue", async () => {
  const { defineComponent, h, onMounted } = await import("vue");
  return {
    default: defineComponent({
      props: { org: { type: String, required: true } },
      setup(props, { expose }) {
        onMounted(() => (fake.mounts += 1));
        expose({ refresh: async () => (fake.refreshes += 1) });
        return () => h("div", { "data-test": "library", "data-org": props.org });
      },
    }),
  };
});

import StarterPacksPage from "./StarterPacksPage.vue";

const FindMore = defineComponent({
  props: { org: { type: String, required: true }, dailyToggle: Boolean },
  emits: ["changed"],
  setup:
    (props, { emit }) =>
    () =>
      h("button", {
        "data-test": "find-more",
        "data-daily": String(props.dailyToggle),
        onClick: () => emit("changed"),
      }),
});

const render = async () => {
  const wrapper = mount(StarterPacksPage, {
    global: { plugins: [i18n], stubs: { StarterPackFindMore: FindMore } },
  });
  await flushPromises();
  return wrapper;
};

describe("StarterPacksPage", () => {
  it("titles the page Starter Packs and hosts the pack list for the org", async () => {
    const wrapper = await render();
    expect(wrapper.get('[data-test="starter-packs-title"]').text()).toBe("Starter Packs");
    expect(wrapper.get('[data-test="library"]').attributes("data-org")).toBe("org");
  });

  it("puts Find more for my data with its daily switch in the header", async () => {
    const wrapper = await render();
    expect(wrapper.get('[data-test="find-more"]').attributes("data-daily")).toBe("true");
  });

  it("re-reads the pack list in place after Find more adds items", async () => {
    const wrapper = await render();
    const before = { mounts: fake.mounts, refreshes: fake.refreshes };
    await wrapper.get('[data-test="find-more"]').trigger("click");
    await flushPromises();
    expect(fake.mounts).toBe(before.mounts);
    expect(fake.refreshes).toBe(before.refreshes + 1);
  });

  it("waits for an org before mounting the pack list", async () => {
    fake.org = undefined;
    const wrapper = await render();
    expect(wrapper.find('[data-test="library"]').exists()).toBe(false);
    fake.org = "org";
  });
});
