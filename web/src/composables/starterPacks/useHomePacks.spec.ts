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

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";

import { fakeFlow } from "@/components/starterPacks/starterPackTestFlow";
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

import { packById } from "./usePackCatalog";
import { resetStarterPackPopups } from "./useStarterPackPopup";
import { useHomePacks, type HomePacks } from "./useHomePacks";

loadCatalogFixture();

const fake = vi.hoisted(() => ({
  flow: null as any,
  flows: {} as Record<string, any>,
  saveBuiltIn: vi.fn(),
  hasUserData: null as any,
  isFetching: null as any,
  noResources: null as any,
  matcher: null as any,
}));
vi.mock("./useStarterPackFlow", () => ({
  useStarterPackFlow: (_org: string, pack: { id: string }) => fake.flows[pack.id] ?? fake.flow,
}));
vi.mock("./useStarterPackMatcher", () => ({ useStarterPackMatcher: () => fake.matcher }));
vi.mock("@/composables/useOrgHasUserData", () => ({
  useOrgHasUserData: () => ({ hasUserData: fake.hasUserData, isFetching: fake.isFetching }),
}));
vi.mock("@/composables/useOrgResources", () => ({
  useOrgHasNoResources: () => ({ noResources: fake.noResources }),
}));
vi.mock("./useBrowserMatches", () => ({
  useBrowserMatches: () => ({ saveBuiltIn: fake.saveBuiltIn }),
}));

const home = (ids = ["kubernetes"]) => {
  let api!: HomePacks;
  mount(
    defineComponent({
      setup() {
        api = useHomePacks(
          "org",
          ids.map((id) => packById(id)!),
        );
        return () => null;
      },
    }),
  );
  return api;
};

describe("useHomePacks", () => {
  beforeEach(() => {
    resetStarterPackPopups();
    fake.flow = fakeFlow();
    fake.flows = {};
    fake.hasUserData = ref<boolean | undefined>(true);
    fake.isFetching = ref(false);
    fake.noResources = ref(true);
    fake.saveBuiltIn.mockClear();
    fake.matcher = {
      state: ref("matched"),
      forbidden: ref(false),
      streams: ref([]),
      checkShared: vi.fn(),
    };
  });

  it("asks for an admin when a refused read also fails the match", () => {
    fake.flow.forbidden.value = true;
    fake.matcher.state.value = "error";
    const packs = home();
    expect(packs.items[0].view.value).toBe("forbidden");
    expect(packs.askAdmin.value).toBe(true);
  });

  it("asks for an admin when only the match's reads are refused", () => {
    fake.matcher.state.value = "error";
    fake.matcher.forbidden.value = true;
    const packs = home();
    expect(packs.items[0].view.value).toBe("forbidden");
    expect(packs.askAdmin.value).toBe(true);
  });

  it("still says error when a read fails for another reason", () => {
    fake.matcher.state.value = "error";
    expect(home().items[0].view.value).toBe("error");
  });

  it("saves every unfinished setup, one running elsewhere included", () => {
    fake.flows.kubernetes = fakeFlow({ interrupted: ref(true) });
    fake.flows.hosts = fakeFlow({ runningBy: ref("o@x") });
    home(["kubernetes", "hosts", "docker"]);
    const [, installed, interrupted] = fake.saveBuiltIn.mock.lastCall!;
    expect(installed).toEqual([]);
    expect(interrupted.map(({ packId }: { packId: string }) => packId)).toEqual([
      "kubernetes",
      "hosts",
    ]);
  });

  describe("a member refused every pack read", () => {
    beforeEach(() => {
      fake.flow.forbidden.value = true;
      fake.noResources.value = false;
    });

    it("is told to ask an admin while the org's data cannot be read", () => {
      fake.hasUserData.value = undefined;
      const packs = home();
      expect(packs.askAdmin.value).toBe(true);
      expect(packs.noAccess.value).toBe(true);
      expect(packs.labelShown.value).toBe(true);
      expect(packs.offerShown.value).toBe(false);
    });

    it.each([
      ["have data and resources", true],
      ["be empty", false],
    ])("is told nothing in an org known to %s", (_what, known) => {
      fake.hasUserData.value = known;
      const packs = home();
      expect(packs.askAdmin.value).toBe(false);
      expect(packs.labelShown.value).toBe(false);
    });

    it("keeps the fits-your-data case apart", () => {
      fake.noResources.value = true;
      const packs = home();
      expect(packs.askAdmin.value).toBe(true);
      expect(packs.noAccess.value).toBe(false);
    });

    it("waits for the data check to finish", () => {
      fake.hasUserData.value = undefined;
      fake.isFetching.value = true;
      const packs = home();
      expect(packs.askAdmin.value).toBe(false);
      fake.isFetching.value = false;
      expect(packs.askAdmin.value).toBe(true);
    });

    it("is told nothing while any pack is readable", () => {
      fake.hasUserData.value = undefined;
      fake.flows.hosts = fakeFlow();
      const packs = home(["kubernetes", "hosts"]);
      expect(packs.askAdmin.value).toBe(false);
    });
  });
});
