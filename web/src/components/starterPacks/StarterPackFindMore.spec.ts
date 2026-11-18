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
}));

vi.mock("@/composables/starterPacks/kubernetesPack", () => ({
  STARTER_PACKS: [{ id: "kubernetes", titleKey: "starterPacks.kubernetes.title" }],
}));
vi.mock("@/composables/starterPacks/useFindMore", () => ({ useFindMore: () => fake.finder }));
vi.mock("@/composables/starterPacks/useDailyCheck", () => ({ useDailyCheck: () => fake.daily }));

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

const render = (props: Record<string, unknown> = {}) =>
  mount(StarterPackFindMore, {
    props: { org: "org", ...props },
    global: {
      plugins: [i18n, createStore({ state: { userInfo: { role: fake.role }, zoConfig: {} } })],
      stubs: { ODrawer: { template: "<div><slot /></div>" }, OIcon: true },
    },
  });
const has = (wrapper: ReturnType<typeof render>, id: string) =>
  wrapper.find(`[data-test="${id}"]`).exists();

describe("StarterPackFindMore", () => {
  beforeEach(() => {
    fake.role = "admin";
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
