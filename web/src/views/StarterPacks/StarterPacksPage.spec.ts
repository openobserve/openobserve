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

const fake = vi.hoisted(() => ({
  mounts: 0,
  refreshes: 0,
  org: "org" as string | undefined,
  check: vi.fn(),
  release: () => {},
}));

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

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/composables/starterPacks/useFindMore", async () => {
  const { ref } = await import("vue");
  return {
    useFindMore: () => {
      const result = ref<unknown>(null);
      const state = ref("idle");
      return {
        result,
        state,
        check: async () => {
          fake.check();
          await new Promise<void>((resolve) => (fake.release = resolve));
          result.value = {
            checkedAt: 1,
            sources: [{ id: "library-nginx", items: [] }],
            dismissed: 0,
          };
          state.value = "ready";
        },
      };
    },
  };
});
vi.mock("@/composables/starterPacks/useInstallRecords", () => ({
  useInstallRecords: () => ({
    list: async (packId: string) => (packId === "hosts" ? [{ status: "complete", items: [] }] : []),
  }),
}));

import {
  resetBrowserMatches,
  useBrowserMatches,
} from "@/composables/starterPacks/useBrowserMatches";
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

  it("puts the refresh before Find more and shows when this browser last checked", async () => {
    window.localStorage.clear();
    resetBrowserMatches();
    useBrowserMatches("org").saveFull({ checkedAt: 1, sources: [], dismissed: 0 }, []);
    const wrapper = await render();
    const html = wrapper.html();
    expect(html.indexOf("starter-packs-refresh-btn")).toBeLessThan(html.indexOf("find-more"));
    expect(wrapper.get('[data-test="starter-packs-checked"]').text()).toBe("Checked just now");
  });

  it("runs the full check, shows it running, and saves the result for the header", async () => {
    window.localStorage.clear();
    resetBrowserMatches();
    const wrapper = await render();
    await wrapper.get('[data-test="starter-packs-refresh-btn"]').trigger("click");
    await flushPromises();
    expect(fake.check).toHaveBeenCalled();
    expect(wrapper.get('[data-test="starter-packs-checking"]').text()).toBe(
      "Checking your streams…",
    );
    fake.release();
    await flushPromises();
    expect(wrapper.find('[data-test="starter-packs-checking"]').exists()).toBe(false);
    const copy = useBrowserMatches("org").copy.value;
    expect(copy?.sources.map(({ id }) => id)).toEqual(["library-nginx"]);
    expect(copy?.installedPackIds).toEqual(["hosts"]);
  });

  it("re-reads the pack list in place after a successful check", async () => {
    window.localStorage.clear();
    resetBrowserMatches();
    const wrapper = await render();
    const before = { mounts: fake.mounts, refreshes: fake.refreshes };
    await wrapper.get('[data-test="starter-packs-refresh-btn"]').trigger("click");
    await flushPromises();
    expect(fake.refreshes).toBe(before.refreshes);
    fake.release();
    await flushPromises();
    expect(fake.mounts).toBe(before.mounts);
    expect(fake.refreshes).toBe(before.refreshes + 1);
  });
});
