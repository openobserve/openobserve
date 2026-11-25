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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createStore } from "vuex";

import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import kv from "@/services/kv";
import organizations from "@/services/organizations";
import { createdOrgs, refreshOrgSummarySoon } from "@/services/orgSummaryRefresh";
import appStore from "@/stores";
import type { FindMoreSource } from "@/composables/starterPacks/findMore";
import {
  resetBrowserMatches,
  useBrowserMatches,
} from "@/composables/starterPacks/useBrowserMatches";
import { packById } from "@/composables/starterPacks/usePackCatalog";
import { resetPackGate } from "@/composables/starterPacks/usePackGate";
import {
  resetStarterPackPopups,
  useStarterPackPopup,
} from "@/composables/starterPacks/useStarterPackPopup";
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

const fake = vi.hoisted(() => ({ installPack: vi.fn() }));

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/composables/query/readQuery", () => ({ readQuery: async () => [] }));
vi.mock("@/composables/starterPacks/useStarterPacks", () => ({
  useStarterPacks: () => ({
    installPack: fake.installPack,
    previewPack: async () => ({ items: [], names: {}, notIncluded: [] }),
    listInstalls: async () => [],
  }),
}));
vi.mock("@/composables/starterPacks/useFindMore", async () => {
  const { ref } = await import("vue");
  return { useFindMore: () => ({ result: ref(null), state: ref("idle"), check: vi.fn() }) };
});
vi.mock("@/composables/starterPacks/useStarterPackMatcher", async () => {
  const { ref } = await import("vue");
  return {
    useStarterPackMatcher: () => ({ clusters: ref([]), streams: ref([]), checkShared: vi.fn() }),
  };
});
vi.mock("./StarterPackDrawer.vue", () => ({ default: { template: "<div />" } }));
vi.mock("./StarterPackListPane.vue", () => ({ default: { template: "<div />" } }));

import StarterPackHeaderChip from "./StarterPackHeaderChip.vue";

loadCatalogFixture();

const ORG = "org";
const ME = "me@x.io";
const K8S: FindMoreSource = {
  id: "kubernetes",
  packId: "kubernetes",
  label: "kubernetes",
  streams: ["kube"],
  items: [],
};

const counts = vi.spyOn(organizations, "get_organization_summary");
const flag = vi.spyOn(kv, "list");
const orgHas = (alerts: number, dashboards: number) =>
  counts.mockResolvedValue({
    data: { alerts: { num_scheduled: alerts, num_realtime: 0 }, total_dashboards: dashboards },
  } as never);

const render = () =>
  mount(StarterPackHeaderChip, {
    global: {
      plugins: [
        i18n,
        createStore({
          state: {
            selectedOrganization: { identifier: ORG },
            userInfo: { email: ME },
            alertLibrary: { manifest: null },
          },
        }),
        [VueQueryPlugin, { queryClient }],
      ],
      stubs: {
        ODialog: { props: ["open"], template: '<div v-if="open"><slot /></div>' },
        OTooltip: { template: "<span><slot /></span>" },
      },
    },
  });

type Chip = ReturnType<typeof render>;
const shown = (wrapper: Chip) => wrapper.find('[data-test="header-starter-packs-btn"]').exists();
// Everything held in memory goes; both storages stay.
const reload = (wrapper?: Chip) => {
  wrapper?.unmount();
  queryClient.clear();
  resetBrowserMatches();
  resetStarterPackPopups();
  resetPackGate();
  createdOrgs.clear();
};
const saveCopy = () =>
  useBrowserMatches(ORG).saveFull({ checkedAt: Date.now(), sources: [K8S], dismissed: 0 }, []);
const load = async () => {
  const wrapper = render();
  await flushPromises();
  return wrapper;
};
// A page load of a small org that got its answer, then a reload.
const answeredSession = async () => {
  orgHas(1, 1);
  saveCopy();
  reload(await load());
  counts.mockClear();
  flag.mockClear();
};

describe("StarterPackHeaderChip with the real gate", () => {
  beforeEach(() => {
    reload();
    window.localStorage.clear();
    window.sessionStorage.clear();
    appStore.commit("setUserInfo", { email: ME });
    counts.mockReset();
    flag.mockReset();
    flag.mockResolvedValue({ data: [] } as never);
    vi.spyOn(kv, "set").mockResolvedValue({ data: "" } as never);
    fake.installPack.mockReset();
  });
  afterEach(() => appStore.commit("setUserInfo", {}));

  it("asks nothing on a page load with no saved copy", async () => {
    const wrapper = await load();
    expect(shown(wrapper)).toBe(false);
    expect([counts.mock.calls.length, flag.mock.calls.length]).toEqual([0, 0]);
    wrapper.unmount();
  });

  it("asks once on the first load of a session, and shows only then", async () => {
    orgHas(1, 1);
    saveCopy();
    const wrapper = render();
    expect(shown(wrapper)).toBe(false);
    await flushPromises();
    expect(shown(wrapper)).toBe(true);
    expect([counts.mock.calls.length, flag.mock.calls.length]).toEqual([1, 1]);
    wrapper.unmount();
  });

  it("shows at once and asks nothing on a reload in the same session", async () => {
    await answeredSession();
    const wrapper = render();
    expect(shown(wrapper)).toBe(true);
    await flushPromises();
    expect([counts.mock.calls.length, flag.mock.calls.length]).toEqual([0, 0]);
    wrapper.unmount();
  });

  it("asks again when the popup opens, without hiding the chip", async () => {
    await answeredSession();
    const wrapper = render();
    await wrapper.get('[data-test="header-starter-packs-btn"]').trigger("click");
    expect(shown(wrapper)).toBe(true);
    await flushPromises();
    expect(counts).toHaveBeenCalledTimes(1);
    expect(shown(wrapper)).toBe(true);
    wrapper.unmount();
  });

  it("hides after a reload once a create by hand takes the org past the limits", async () => {
    await answeredSession();
    orgHas(11, 11);
    const wrapper = await load();
    expect(shown(wrapper)).toBe(true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    refreshOrgSummarySoon(ORG);
    vi.advanceTimersByTime(1_000);
    vi.useRealTimers();
    await flushPromises();
    expect(counts).toHaveBeenCalledTimes(1);
    expect(shown(wrapper)).toBe(false);
    reload(wrapper);
    const next = await load();
    expect(shown(next)).toBe(false);
    next.unmount();
  });

  it.each([
    ["counts", () => orgHas(11, 11)],
    [
      "flag",
      () => (orgHas(1, 1), flag.mockResolvedValue({ data: ["starter_pack_retired"] } as never)),
    ],
  ])("never shows on the first load of an org retired by its %s", async (_by, arrange) => {
    arrange();
    saveCopy();
    const wrapper = render();
    const seen = [shown(wrapper)];
    for (let turn = 0; turn < 10; turn += 1) {
      await Promise.resolve();
      seen.push(shown(wrapper));
    }
    await flushPromises();
    expect([...seen, shown(wrapper)]).not.toContain(true);
    expect(useBrowserMatches(ORG).copy.value).toBeNull();
    wrapper.unmount();
  });

  it("asks again on the next load after a setup ends", async () => {
    await answeredSession();
    const wrapper = await load();
    fake.installPack.mockRejectedValueOnce(new Error("down"));
    await useStarterPackPopup(ORG).entryOf(packById("kubernetes")!).flow.install();
    await flushPromises();
    reload(wrapper);
    counts.mockClear();
    const next = render();
    expect(shown(next)).toBe(false);
    await flushPromises();
    expect(counts).toHaveBeenCalledTimes(1);
    expect(shown(next)).toBe(true);
    next.unmount();
  });
});
