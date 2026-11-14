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
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";

import i18n from "@/locales";
import type { FindMoreSource } from "@/composables/starterPacks/findMore";
import {
  resetBrowserMatches,
  useBrowserMatches,
} from "@/composables/starterPacks/useBrowserMatches";

const ORG = "org";

const fake = vi.hoisted(() => ({
  toast: vi.fn(),
  push: vi.fn(async () => {}),
  check: vi.fn(),
  checkResult: null as null | { checkedAt: number; sources: unknown[]; dismissed: number },
  checkState: "ready" as "ready" | "error",
  records: {} as Record<string, Array<Record<string, unknown>>>,
  flows: [] as Array<Record<string, any>>,
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: fake.toast }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: fake.push }) }));
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
          result.value = fake.checkResult;
          state.value = fake.checkState;
        },
      };
    },
  };
});
vi.mock("@/composables/starterPacks/useInstallRecords", () => ({
  useInstallRecords: () => ({ list: async (packId: string) => fake.records[packId] ?? [] }),
}));
vi.mock("@/composables/starterPacks/useStarterPackFlow", async () => {
  const { ref, computed } = await import("vue");
  return {
    useStarterPackFlow: (_org: string, pack: { id: string }) => {
      const running = ref(false);
      const record = ref<{ status: string } | null>(null);
      const flow = {
        pack,
        running,
        record,
        installed: computed(() => record.value?.status === "complete"),
        install: vi.fn(),
        load: vi.fn(async () => {}),
        packLink: () => "",
      };
      fake.flows.push(flow);
      return flow;
    },
  };
});
vi.mock("@/composables/starterPacks/useStarterPackMatcher", async () => {
  const { ref } = await import("vue");
  return { useStarterPackMatcher: () => ({ clusters: ref([]), check: vi.fn() }) };
});
vi.mock("./StarterPackDrawer.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      props: { open: Boolean, flow: { type: Object, required: true } },
      setup: (props) => () =>
        h("div", {
          "data-test": `drawer-${props.flow.pack.id}`,
          "data-open": String(props.open),
        }),
    }),
  };
});

import StarterPackHeaderChip from "./StarterPackHeaderChip.vue";

// Render the popover and menus inline instead of inside closed reka-ui layers.
const SlotStub = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h("div", [slots.trigger?.(), slots.default?.()]),
});
const ItemStub = defineComponent({
  emits: ["select"],
  setup:
    (_, { slots, emit, attrs }) =>
    () =>
      h("button", { ...attrs, onClick: () => emit("select") }, slots.default?.()),
});

const source = (id: string, packId?: string): FindMoreSource => ({
  id,
  packId,
  label: id,
  streams: [`${id}_logs`, `${id}_more`],
  items: [
    { kind: "dashboard", id: `${id}/d`, name: "D", queries: 0 },
    { kind: "alert", id: `${id}/a`, name: "A", queries: 1 },
  ],
  queriesPerDay: 1,
});

const save = (sources: FindMoreSource[], installed = ["kubernetes"], interrupted = null) =>
  useBrowserMatches(ORG).saveFull({ checkedAt: 1, sources, dismissed: 0 }, installed, interrupted);

let wrapper: VueWrapper | null = null;

const render = async (kioskMode = false) => {
  const store = createStore({
    state: { selectedOrganization: { identifier: ORG }, kioskMode, zoConfig: {} },
  });
  wrapper = mount(StarterPackHeaderChip, {
    global: {
      plugins: [store, i18n],
      stubs: { OPopover: SlotStub, ODropdown: SlotStub, ODropdownItem: ItemStub },
    },
  });
  await flushPromises();
  return wrapper;
};

const chip = () => wrapper!.find('[data-test="header-starter-packs-btn"]');
const byTest = (id: string) => wrapper!.get(`[data-test="${id}"]`);

describe("StarterPackHeaderChip", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetBrowserMatches();
    fake.flows = [];
    fake.records = {};
    fake.checkResult = null;
    fake.checkState = "ready";
    vi.clearAllMocks();
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("stays hidden before any pack is installed", async () => {
    save([source("library-nginx")], []);
    await render();
    expect(chip().exists()).toBe(false);
  });

  it("stays hidden when every match was put off with Not now", async () => {
    save([source("library-nginx")]);
    useBrowserMatches(ORG).notNowAll();
    await render();
    expect(chip().exists()).toBe(false);
  });

  it("stays hidden in kiosk mode", async () => {
    save([source("library-nginx")]);
    await render(true);
    expect(chip().exists()).toBe(false);
  });

  it("shows the count of matches and names it for screen readers", async () => {
    save([source("library-nginx"), source("hosts", "hosts")]);
    await render();
    expect(byTest("header-starter-packs-count").text()).toBe("2");
    expect(chip().attributes("aria-label")).toBe("Starter packs, 2 fit your data");
    expect(byTest("header-starter-packs-fits-hosts").text()).toBe("Fits hosts_logs +1");
  });

  it("makes no check on its own", async () => {
    save([source("library-nginx")]);
    await render();
    expect(fake.check).not.toHaveBeenCalled();
  });

  it("lists five matches and links the rest to Starter Packs", async () => {
    save(["a", "b", "c", "d", "e", "f", "g"].map((id) => source(`library-${id}`)));
    await render();
    expect(wrapper!.findAll('[data-test^="header-starter-packs-row-"]')).toHaveLength(5);
    expect(byTest("header-starter-packs-more").text()).toBe("+2 more in Starter Packs");
  });

  it("opens the setup popup on Set up and does not install", async () => {
    save([source("hosts", "hosts")]);
    await render();
    await byTest("header-starter-packs-setup-btn-hosts").trigger("click");
    await nextTick();
    expect(byTest("drawer-hosts").attributes("data-open")).toBe("true");
    const hosts = fake.flows.find((flow) => flow.pack.id === "hosts")!;
    expect(hosts.install).not.toHaveBeenCalled();
    expect(hosts.load).toHaveBeenCalled();
  });

  it("sends a Library match to the Starter Packs page", async () => {
    save([source("library-nginx")]);
    await render();
    await byTest("header-starter-packs-setup-btn-library-nginx").trigger("click");
    expect(fake.push).toHaveBeenCalledWith({
      name: "starterPacks",
      query: { org_identifier: ORG },
    });
  });

  it("finishes a stopped setup through the same popup", async () => {
    useBrowserMatches(ORG).saveFull(
      { checkedAt: 1, sources: [source("library-nginx")], dismissed: 0 },
      ["kubernetes"],
      {
        packId: "hosts",
        label: "Hosts",
        done: 5,
        total: 7,
      },
    );
    await render();
    expect(byTest("header-starter-packs-finish").text()).toContain("5 of 7 done");
    await byTest("header-starter-packs-finish-btn").trigger("click");
    await nextTick();
    expect(byTest("drawer-hosts").attributes("data-open")).toBe("true");
  });

  it("hides one match on Not now", async () => {
    save([source("library-nginx"), source("library-docker")]);
    await render();
    await byTest("header-starter-packs-not-now-library-nginx").trigger("click");
    expect(byTest("header-starter-packs-count").text()).toBe("1");
    expect(wrapper!.find('[data-test="header-starter-packs-row-library-nginx"]').exists()).toBe(
      false,
    );
  });

  it("hides the chip on Not now for all and brings it back on Undo", async () => {
    save([source("library-nginx")]);
    await render();
    await byTest("header-starter-packs-not-now-all").trigger("click");
    expect(chip().exists()).toBe(false);
    const [[options]] = fake.toast.mock.calls as unknown as [
      [{ message: string; action: { handler: () => void } }],
    ];
    expect(options.message).toBe("Starter packs hidden until a new one fits your data");
    options.action.handler();
    await nextTick();
    expect(chip().exists()).toBe(true);
  });

  it("refreshes with the full check and saves the result in this browser", async () => {
    save([source("library-nginx")]);
    fake.checkResult = {
      checkedAt: 2,
      sources: [source("library-nginx"), source("library-docker")],
      dismissed: 0,
    };
    fake.records = { hosts: [{ status: "complete", items: [] }] };
    await render();
    await byTest("header-starter-packs-refresh").trigger("click");
    await flushPromises();
    expect(fake.check).toHaveBeenCalledTimes(1);
    expect(byTest("header-starter-packs-count").text()).toBe("2");
    expect(useBrowserMatches(ORG).copy.value?.installedPackIds).toEqual(["hosts"]);
    expect(byTest("header-starter-packs-checked").text()).toBe("Checked just now");
  });

  it("keeps the old result and offers Retry when the check fails", async () => {
    save([source("library-nginx")]);
    fake.checkState = "error";
    await render();
    await byTest("header-starter-packs-refresh").trigger("click");
    await flushPromises();
    expect(byTest("header-starter-packs-count").text()).toBe("1");
    const [[options]] = fake.toast.mock.calls as unknown as [
      [{ variant: string; action: { label: string } }],
    ];
    expect(options.variant).toBe("error");
    expect(options.action.label).toBe("Retry");
  });
});
