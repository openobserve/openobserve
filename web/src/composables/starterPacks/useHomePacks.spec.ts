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
  matcher: null as any,
}));
vi.mock("./useStarterPackFlow", () => ({ useStarterPackFlow: () => fake.flow }));
vi.mock("./useStarterPackMatcher", () => ({ useStarterPackMatcher: () => fake.matcher }));
vi.mock("@/composables/useOrgHasUserData", () => ({
  useOrgHasUserData: () => ({ hasUserData: ref(true) }),
}));
vi.mock("@/composables/useOrgResources", () => ({
  useOrgHasNoResources: () => ({ noResources: ref(true) }),
}));
vi.mock("./useBrowserMatches", () => ({ useBrowserMatches: () => ({ saveBuiltIn: vi.fn() }) }));

const home = () => {
  let api!: HomePacks;
  mount(
    defineComponent({
      setup() {
        api = useHomePacks("org", [packById("kubernetes")!]);
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
    fake.matcher = { state: ref("matched"), streams: ref([]), checkShared: vi.fn() };
  });

  it("asks for an admin when a refused read also fails the match", () => {
    fake.flow.forbidden.value = true;
    fake.matcher.state.value = "error";
    const packs = home();
    expect(packs.items[0].view.value).toBe("forbidden");
    expect(packs.askAdmin.value).toBe(true);
  });

  it("still says error when a read fails for another reason", () => {
    fake.matcher.state.value = "error";
    expect(home().items[0].view.value).toBe("error");
  });
});
