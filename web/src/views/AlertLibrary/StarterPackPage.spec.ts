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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref, shallowRef } from "vue";

import { fakeFlow } from "@/components/starterPacks/starterPackTestFlow";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import StarterPackPage from "./StarterPackPage.vue";

const fake = vi.hoisted(() => ({
  flow: null as any,
  turn: null as any,
  isEnterprise: "false",
}));

vi.mock("@/aws-exports", () => ({
  default: {
    get isEnterprise() {
      return fake.isEnterprise;
    },
  },
}));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: { org_identifier: "org" } }),
  useRouter: () => ({ push: vi.fn(async () => undefined) }),
}));
vi.mock("@/composables/starterPacks/useStarterPackFlow", () => ({
  useStarterPackFlow: () => fake.flow,
}));
vi.mock("@/composables/starterPacks/useTurnOnAlerts", () => ({
  useTurnOnAlerts: () => fake.turn,
}));
vi.mock("@/composables/starterPacks/useStarterPackMatcher", () => ({
  useStarterPackMatcher: () => ({ clusters: ref(["eu"]), check: vi.fn() }),
}));
vi.mock("@/composables/starterPacks/usePackHealth", () => ({
  usePackHealth: () => ({ staleStreams: ref(new Set()), staleSince: ref(null), check: vi.fn() }),
}));
vi.mock("@/composables/query/readQuery", () => ({
  readQuery: vi.fn(async () => [{ name: "Team folder" }]),
}));

const row = (enabled: boolean) => ({
  id: "a",
  name: "Alert a",
  severity: "warning",
  enabled,
  alert: { stream_name: "s", destinations: ["chat"], trigger_condition: { frequency: 5 } },
});

const render = async () => {
  const wrapper = mount(StarterPackPage, {
    global: {
      plugins: [i18n, store],
      stubs: {
        OPageLayout: { template: "<div><slot name='actions' /><slot /></div>" },
        OTable: {
          props: ["data"],
          template: `<div><div v-for="row in data" :key="row.id"><slot name="cell-actions" :row="row" /></div></div>`,
        },
        StarterPackDrawer: true,
        StarterPackHealthLine: true,
        StarterPackUndoDialog: true,
        TurnOnAlertsDrawer: true,
        QuickMuteDialog: true,
        OIcon: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
};
const has = (wrapper: any, id: string) => wrapper.find(`[data-test="${id}"]`).exists();

describe("StarterPackPage", () => {
  beforeEach(() => {
    fake.isEnterprise = "false";
    fake.flow = fakeFlow({ record: shallowRef({ items: [], installedBy: "a@example.com" }) });
    const rows = shallowRef([row(true)]);
    fake.turn = {
      rows,
      loadState: ref("ready"),
      load: vi.fn(),
      forbidden: ref(false),
      setThreshold: vi.fn(),
      turnOff: vi.fn(),
      chosenRows: computed(() => []),
    };
  });

  it("offers no Mute on OSS, where the route answers 403", async () => {
    expect(has(await render(), "starter-pack-page-mute-btn")).toBe(false);
  });

  it("turns every pack alert off in one action", async () => {
    const wrapper = await render();
    await wrapper.get('[data-test="starter-pack-page-turn-off-all-btn"]').trigger("click");
    expect(fake.turn.turnOff).toHaveBeenCalledWith([expect.objectContaining({ id: "a" })]);
  });

  it("gives an admin Set up in… when the pack is not installed", async () => {
    fake.flow = fakeFlow({ isAdmin: ref(true) });
    const wrapper = await render();
    expect(has(wrapper, "starter-pack-page-folder-select")).toBe(true);
    expect(has(wrapper, "starter-pack-page-setup-btn")).toBe(true);
  });

  it("hides the folder picker from anyone else", async () => {
    fake.flow = fakeFlow();
    expect(has(await render(), "starter-pack-page-folder-select")).toBe(false);
  });

  it("shows Copy link for an admin when a write is refused", async () => {
    fake.turn.forbidden.value = true;
    expect(has(await render(), "starter-pack-page-copy-link-btn")).toBe(true);
  });
});
