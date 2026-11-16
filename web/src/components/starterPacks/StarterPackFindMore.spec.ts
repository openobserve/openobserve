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
import { ref } from "vue";
import { createStore } from "vuex";

import i18n from "@/locales";

const fake = vi.hoisted(() => ({
  role: "admin",
  finder: null as any,
  daily: null as any,
  push: vi.fn(async () => {}),
  record: null as null | { status: string },
  flows: [] as Array<Record<string, any>>,
  checks: vi.fn(),
}));

vi.mock("@/composables/starterPacks/kubernetesPack", () => ({
  STARTER_PACKS: [{ id: "kubernetes", titleKey: "starterPacks.kubernetes.title" }],
}));
vi.mock("@/composables/starterPacks/useFindMore", () => ({ useFindMore: () => fake.finder }));
vi.mock("@/composables/starterPacks/useDailyCheck", () => ({ useDailyCheck: () => fake.daily }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: fake.push }) }));
vi.mock("@/composables/starterPacks/useStarterPackFlow", async () => {
  const { ref } = await import("vue");
  return {
    useStarterPackFlow: (_org: string, pack: { id: string }) => {
      const record = ref<{ status: string } | null>(null);
      const flow = {
        pack,
        record,
        load: vi.fn(async () => {
          record.value = fake.record;
        }),
        packLink: () => "",
      };
      fake.flows.push(flow);
      return flow;
    },
  };
});
vi.mock("@/composables/starterPacks/useStarterPackMatcher", async () => {
  const { ref } = await import("vue");
  return { useStarterPackMatcher: () => ({ clusters: ref([]), check: fake.checks }) };
});
vi.mock("./StarterPackDrawer.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      props: { open: Boolean, flow: { type: Object, required: true } },
      emits: ["update:open", "installed"],
      setup: (props, { emit }) => () =>
        h("button", {
          "data-test": `drawer-${props.flow.pack.id}`,
          "data-open": String(props.open),
          onClick: () => emit("installed"),
        }),
    }),
  };
});

import StarterPackFindMore from "./StarterPackFindMore.vue";

const NGINX = {
  id: "library-nginx",
  label: "nginx",
  streams: ["edge"],
  items: [
    { kind: "alert", id: "nginx/5xx", name: "Nginx 5xx rate", queries: 288 },
    { kind: "alert", id: "nginx/slow", name: "Nginx slow upstream", queries: 288 },
  ],
  queriesPerDay: 576,
};

const PACK = {
  id: "kubernetes",
  packId: "kubernetes",
  label: "kubernetes",
  streams: [],
  items: [{ kind: "alert", id: "k8s/one", name: "One", queries: 288 }],
  queriesPerDay: 288,
};

const render = (props: Record<string, unknown> = {}) =>
  mount(StarterPackFindMore, {
    props: { org: "org", ...props },
    global: {
      plugins: [i18n, createStore({ state: { userInfo: { role: fake.role }, zoConfig: {} } })],
      stubs: {
        ODrawer: {
          props: ["open"],
          template: '<div :data-open="String(open)"><slot /></div>',
        },
        OIcon: true,
      },
    },
  });
const has = (wrapper: ReturnType<typeof render>, id: string) =>
  wrapper.find(`[data-test="${id}"]`).exists();

describe("StarterPackFindMore", () => {
  beforeEach(() => {
    fake.role = "admin";
    fake.record = null;
    fake.flows = [];
    fake.push.mockClear();
    fake.checks.mockClear();
    fake.finder = {
      result: ref(null),
      state: ref("idle"),
      added: ref([]),
      busy: ref(null),
      check: vi.fn(async () => {}),
      add: vi.fn(async (source: unknown) => {
        fake.finder.added.value = [...fake.finder.added.value, { source }];
        return true;
      }),
      undo: vi.fn(async () => true),
      dismissSource: vi.fn(async () => {}),
      dismissItem: vi.fn(async () => {}),
      restoreDismissed: vi.fn(async () => {}),
    };
    fake.daily = {
      enabled: ref(false),
      last: ref(null),
      load: vi.fn(async () => {}),
      setEnabled: vi.fn(async () => {}),
    };
  });

  it("runs the check when opened", async () => {
    const wrapper = render();
    await wrapper.get('[data-test="starter-pack-find-more-btn"]').trigger("click");
    expect(fake.finder.check).toHaveBeenCalled();
    expect(wrapper.emitted("opened")).toHaveLength(1);
  });

  it("says nothing new fits, checked just now, when no source matches", () => {
    fake.finder.result.value = { checkedAt: Date.now() * 1000, sources: [], dismissed: 0 };
    fake.finder.state.value = "ready";
    const wrapper = render();
    expect(wrapper.get('[data-test="starter-pack-find-more-empty"]').text()).toBe(
      "Nothing new fits your data. Checked just now.",
    );
  });

  it("shows one row per source with its counts, alerts and one Add", async () => {
    fake.finder.result.value = { checkedAt: Date.now() * 1000, sources: [NGINX], dismissed: 2 };
    fake.finder.state.value = "ready";
    const wrapper = render();
    const row = wrapper.get('[data-test="starter-pack-find-more-source-library-nginx"]');
    expect(row.text()).toContain("nginx · edge");
    expect(row.text()).toContain("2 alerts");
    expect(row.text()).toContain("Nginx slow upstream");
    expect(row.text()).toContain("576");
    expect(wrapper.text()).toContain("2 matches you dismissed");
    await wrapper.get('[data-test="starter-pack-find-more-add-library-nginx"]').trigger("click");
    expect(fake.finder.add).toHaveBeenCalledWith(NGINX);
    await flushPromises();
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("opens a pack not set up in its setup popup at step 1 instead of installing it", async () => {
    fake.finder.result.value = { checkedAt: Date.now() * 1000, sources: [PACK], dismissed: 0 };
    fake.finder.state.value = "ready";
    const wrapper = render();
    await wrapper.get('[data-test="starter-pack-find-more-btn"]').trigger("click");
    await flushPromises();
    const button = wrapper.get('[data-test="starter-pack-find-more-add-kubernetes"]');
    expect(button.text()).toBe("Set up");
    await button.trigger("click");
    await flushPromises();
    expect(fake.finder.add).not.toHaveBeenCalled();
    expect(fake.push).not.toHaveBeenCalled();
    expect(fake.flows[0].record.value).toBeNull();
    expect(fake.checks).toHaveBeenCalled();
    expect(wrapper.get('[data-test="drawer-kubernetes"]').attributes("data-open")).toBe("true");
    expect(wrapper.get('[data-test="starter-pack-find-more-drawer"]').attributes("data-open")).toBe("false");
  });

  it("refreshes the list and tells the page once the popup sets the pack up", async () => {
    fake.finder.result.value = { checkedAt: Date.now() * 1000, sources: [PACK], dismissed: 0 };
    fake.finder.state.value = "ready";
    const wrapper = render();
    await wrapper.get('[data-test="starter-pack-find-more-add-kubernetes"]').trigger("click");
    await flushPromises();
    fake.finder.check.mockClear();
    await wrapper.get('[data-test="drawer-kubernetes"]').trigger("click");
    expect(wrapper.emitted("changed")).toHaveLength(1);
    expect(fake.finder.check).toHaveBeenCalled();
  });

  it("sends an installed pack's new matches to its pack page, never installing them", async () => {
    fake.record = { status: "complete" };
    fake.finder.result.value = { checkedAt: Date.now() * 1000, sources: [PACK], dismissed: 0 };
    fake.finder.state.value = "ready";
    const wrapper = render();
    await wrapper.get('[data-test="starter-pack-find-more-btn"]').trigger("click");
    await flushPromises();
    const button = wrapper.get('[data-test="starter-pack-find-more-add-kubernetes"]');
    expect(button.text()).toBe("Open pack");
    await button.trigger("click");
    await flushPromises();
    expect(fake.finder.add).not.toHaveBeenCalled();
    expect(fake.push).toHaveBeenCalledWith({
      name: "starterPack",
      params: { pack: "kubernetes" },
      query: { org_identifier: "org" },
    });
    expect(wrapper.find('[data-test="drawer-kubernetes"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="starter-pack-find-more-drawer"]').attributes("data-open")).toBe("false");
  });

  it("dismisses one item or the whole source", async () => {
    fake.finder.result.value = { checkedAt: Date.now() * 1000, sources: [NGINX], dismissed: 0 };
    fake.finder.state.value = "ready";
    const wrapper = render();
    await wrapper
      .get('[data-test="starter-pack-find-more-dismiss-item-nginx/5xx"]')
      .trigger("click");
    expect(fake.finder.dismissItem).toHaveBeenCalledWith("library-nginx", "nginx/5xx");
    await wrapper
      .get('[data-test="starter-pack-find-more-dismiss-library-nginx"]')
      .trigger("click");
    expect(fake.finder.dismissSource).toHaveBeenCalledWith("library-nginx");
  });

  it("offers Undo for what an Add made", async () => {
    const entry = { source: NGINX, installId: "i", itemIds: ["nginx/5xx"], newRecord: true };
    fake.finder.added.value = [entry];
    const wrapper = render();
    await wrapper.get('[data-test="starter-pack-find-more-undo-library-nginx"]').trigger("click");
    expect(fake.finder.undo).toHaveBeenCalledWith(entry);
  });

  it("shows the daily toggle to admins only, off by default", async () => {
    expect(has(render({ dailyToggle: true }), "starter-pack-find-more-daily")).toBe(true);
    expect(has(render(), "starter-pack-find-more-daily")).toBe(false);
    fake.role = "member";
    expect(has(render({ dailyToggle: true }), "starter-pack-find-more-daily")).toBe(false);
  });

  it("counts a pack's saved views apart from its alerts", () => {
    const items = [
      { kind: "dashboard", id: "overview", name: "Overview", queries: 0 },
      { kind: "alert", id: "k8s/one", name: "One", queries: 288 },
      { kind: "savedView", id: "events", name: "Events", queries: 0 },
    ];
    const source = {
      id: "kubernetes",
      packId: "kubernetes",
      label: "kubernetes",
      streams: [],
      items,
      queriesPerDay: 288,
    };
    fake.finder.result.value = { checkedAt: Date.now() * 1000, sources: [source], dismissed: 0 };
    fake.finder.state.value = "ready";
    const row = render().get('[data-test="starter-pack-find-more-source-kubernetes"]');
    expect(row.text()).toContain("1 dashboard, 1 alert, 1 saved view");
  });

  it("counts the daily suggestions on the button and the Home link", () => {
    fake.daily.enabled.value = true;
    fake.daily.last.value = { checkedAt: 1, sources: [NGINX], dismissed: 0 };
    expect(render().get('[data-test="starter-pack-find-more-count"]').text()).toBe("1");
    const link = render({ variant: "link" });
    expect(link.get('[data-test="starter-pack-find-more-btn"]').text()).toContain(
      "Find packs for other data",
    );
    expect(link.get('[data-test="starter-pack-find-more-count"]').text()).toBe("1");
  });

  it("follows the drawer's latest check once one has run", () => {
    fake.daily.enabled.value = true;
    fake.daily.last.value = { checkedAt: 1, sources: [NGINX], dismissed: 0 };
    fake.finder.result.value = { checkedAt: 2, sources: [], dismissed: 0 };
    expect(has(render(), "starter-pack-find-more-count")).toBe(false);
  });

  it("reloads the stored suggestions after turning the daily check on", async () => {
    const wrapper = render({ dailyToggle: true });
    fake.daily.load.mockClear();
    await wrapper.findComponent({ name: "OSwitch" }).vm.$emit("update:modelValue", true);
    await flushPromises();
    expect(fake.daily.setEnabled).toHaveBeenCalledWith(true);
    expect(fake.daily.load).toHaveBeenCalled();
  });

  it("shows no count while the daily check is off", () => {
    fake.daily.last.value = { checkedAt: 1, sources: [NGINX], dismissed: 0 };
    expect(has(render(), "starter-pack-find-more-count")).toBe(false);
  });
});
