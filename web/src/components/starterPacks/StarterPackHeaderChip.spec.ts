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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";

import i18n from "@/locales";
import type { FindMoreSource } from "@/composables/starterPacks/findMore";
import {
  resetBrowserMatches,
  useBrowserMatches,
} from "@/composables/starterPacks/useBrowserMatches";
import {
  resetStarterPackPopups,
  useStarterPackPopup,
} from "@/composables/starterPacks/useStarterPackPopup";

const ORG = "org";

const fake = vi.hoisted(() => ({
  checkResult: null as null | { checkedAt: number; sources: unknown[]; dismissed: number },
  checkState: "ready" as "ready" | "error",
  gateVisible: true,
  flows: {} as Record<string, Record<string, any>>,
  records: {} as Record<string, Record<string, any>>,
  matchers: [] as Array<Record<string, any>>,
  loadGate: null as null | Promise<void>,
}));

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/composables/starterPacks/usePackGate", async () => {
  const { computed } = await import("vue");
  return { usePackGate: () => ({ visible: computed(() => fake.gateVisible) }) };
});
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
          result.value = fake.checkResult;
          state.value = fake.checkState;
        },
      };
    },
  };
});
vi.mock("@/composables/starterPacks/useInstallRecords", () => ({
  useInstallRecords: () => ({ list: async () => [] }),
}));
vi.mock("@/composables/starterPacks/useStarterPackFlow", async () => {
  const { ref, computed, shallowRef } = await import("vue");
  return {
    useStarterPackFlow: (_org: string, pack: { id: string }) => {
      const record = shallowRef<Record<string, any> | null>(null);
      const running = ref(false);
      const flow = {
        pack,
        running,
        record,
        loaded: ref(false),
        installed: computed(() => record.value?.status === "complete"),
        interrupted: computed(
          () => !running.value && !!record.value && record.value.status !== "complete",
        ),
        items: computed(() => record.value?.items ?? []),
        made: ref([]),
        toCreate: ref([]),
        preview: shallowRef<Record<string, any> | null>(null),
        previewState: ref("idle"),
        nameOf: (id: string) => `name-${id}`,
        load: vi.fn(async () => {
          if (fake.loadGate) await fake.loadGate;
          record.value = fake.records[pack.id] ?? null;
          flow.loaded.value = true;
        }),
        loadPreview: vi.fn(async () => {}),
      };
      fake.flows[pack.id] = flow;
      return flow;
    },
  };
});
vi.mock("@/composables/starterPacks/useStarterPackMatcher", async () => {
  const { ref } = await import("vue");
  return {
    useStarterPackMatcher: (_org: string, options?: { pack?: { id: string } }) => {
      const matcher = {
        packId: options?.pack?.id,
        state: ref("checking"),
        clusters: ref<string[]>([]),
        check: vi.fn(),
        checkShared: vi.fn(),
      };
      fake.matchers.push(matcher);
      return matcher;
    },
  };
});
vi.mock("./StarterPackDrawer.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      props: { flow: { type: Object, required: true }, showBack: Boolean },
      emits: ["close", "back"],
      setup:
        (props, { emit }) =>
        () =>
          h("div", { "data-test": `pane-${props.flow.pack.id}`, "data-back": props.showBack }, [
            h("button", { "data-test": "pane-back", onClick: () => emit("back") }),
            h("button", { "data-test": "pane-close", onClick: () => emit("close") }),
          ]),
    }),
  };
});

import StarterPackHeaderChip from "./StarterPackHeaderChip.vue";
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

loadCatalogFixture();

const source = (packId: string, items: FindMoreSource["items"] = []): FindMoreSource => ({
  id: packId,
  packId,
  label: packId,
  streams: [`${packId}_metrics`, `${packId}_logs`],
  items,
});

const K8S = source("kubernetes", [
  { kind: "dashboard", id: "overview", name: "Kubernetes Overview" },
  { kind: "alert", id: "k8s/pod_crashloop_backoff", name: "Pod Crashloop Backoff" },
  { kind: "alert", id: "k8s/pod_oom_killed", name: "Pod Oom Killed" },
]);
const HOSTS = source("hosts", [{ kind: "dashboard", id: "host_metrics", name: "Host Metrics" }]);
const DOCKER = source("docker", [{ kind: "dashboard", id: "overview", name: "Docker Overview" }]);

// The browser copy and the install records agree, as they do after a check.
const save = (sources: FindMoreSource[], installed: string[] = []) => {
  for (const id of installed) {
    fake.records[id] = { status: "complete", installedAt: (Date.now() - 2 * 3_600_000) * 1000 };
  }
  useBrowserMatches(ORG).saveFull({ checkedAt: Date.now(), sources, dismissed: 0 }, installed);
};

const render = (state: Record<string, unknown> = {}) =>
  mount(StarterPackHeaderChip, {
    global: {
      plugins: [
        i18n,
        createStore({ state: { selectedOrganization: { identifier: ORG }, ...state } }),
      ],
      stubs: {
        ODialog: {
          props: ["open"],
          template: '<div v-if="open" data-test="stub-popup"><slot /></div>',
        },
        OTooltip: { template: "<span><slot /></span>" },
      },
    },
  });

const find = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`);
const chip = (wrapper: VueWrapper) => wrapper.get('[data-test="header-starter-packs-btn"]');
const open = async (wrapper: VueWrapper) => {
  await chip(wrapper).trigger("click");
  await flushPromises();
};
const railIds = (wrapper: VueWrapper) =>
  wrapper
    .findAll('[data-test^="starter-pack-list-row-"]')
    .map((row) => row.attributes("data-test"))
    .filter((id) => !id!.includes("-done-"))
    .map((id) => id!.replace("starter-pack-list-row-", ""));

describe("StarterPackHeaderChip", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetBrowserMatches();
    resetStarterPackPopups();
    fake.gateVisible = true;
    fake.checkResult = null;
    fake.checkState = "ready";
    fake.records = {};
    fake.loadGate = null;
    fake.matchers = [];
  });

  it("stays hidden until a check has run, then shows the count of packs not set up", async () => {
    const wrapper = render();
    expect(find(wrapper, "header-starter-packs-btn").exists()).toBe(false);
    save([K8S, HOSTS]);
    await flushPromises();
    expect(find(wrapper, "header-starter-packs-count").text()).toBe("2");
  });

  it("stays visible at 0 once every matching pack is set up", async () => {
    save([K8S], ["kubernetes"]);
    const wrapper = render();
    expect(find(wrapper, "header-starter-packs-count").text()).toBe("0");
  });

  it("is hidden in kiosk mode and for an org past onboarding (D10)", () => {
    save([K8S]);
    expect(find(render({ kioskMode: true }), "header-starter-packs-btn").exists()).toBe(false);
    fake.gateVisible = false;
    expect(find(render(), "header-starter-packs-btn").exists()).toBe(false);
  });

  it("reads no pack record or plan for an org past onboarding, even with the popup open", async () => {
    save([K8S, HOSTS]);
    fake.gateVisible = false;
    const wrapper = render();
    useStarterPackPopup(ORG).openList();
    await flushPromises();
    expect(fake.flows.kubernetes.load).not.toHaveBeenCalled();
    expect(fake.flows.kubernetes.loadPreview).not.toHaveBeenCalled();
    expect(fake.matchers.every(({ checkShared }) => !checkShared.mock.calls.length)).toBe(true);
    wrapper.unmount();
  });

  it("opens the list with every matching pack in catalog order and the first one selected", async () => {
    save([HOSTS, K8S, DOCKER], ["docker"]);
    const wrapper = render();
    await open(wrapper);
    expect(railIds(wrapper)).toEqual(["kubernetes", "hosts", "docker"]);
    expect(find(wrapper, "starter-pack-list-row-done-docker").exists()).toBe(true);
    expect(find(wrapper, "starter-pack-list-row-docker").text()).toContain("Set up 2 h ago");
    expect(find(wrapper, "starter-pack-list-hero").text()).toContain("Kubernetes");
    expect(find(wrapper, "starter-pack-list-subtitle").text()).toBe(
      "2 packs fit data you already send",
    );
  });

  it("badges the first pack only while no pack is set up (D1)", async () => {
    save([K8S, HOSTS]);
    const wrapper = render();
    await open(wrapper);
    expect(find(wrapper, "starter-pack-list-best-start").text()).toBe("Best place to start");
    await find(wrapper, "starter-pack-list-row-hosts").trigger("click");
    expect(find(wrapper, "starter-pack-list-best-start").exists()).toBe(false);
    await find(wrapper, "starter-pack-list-row-kubernetes").trigger("click");
    fake.flows.kubernetes.record.value = { status: "complete" };
    await flushPromises();
    expect(find(wrapper, "starter-pack-list-best-start").exists()).toBe(false);
  });

  it("offers no Not now and no way to hide a pack; the close button is the only way out (D2)", async () => {
    save([K8S, HOSTS]);
    const wrapper = render();
    await open(wrapper);
    expect(wrapper.text()).not.toMatch(/not now/i);
    expect(wrapper.text()).not.toMatch(/hide/i);
    await find(wrapper, "starter-pack-popup-close-btn").trigger("click");
    expect(find(wrapper, "stub-popup").exists()).toBe(false);
  });

  it("swaps the right pane on a rail click and fills the tiles from the summaries", async () => {
    save([K8S, HOSTS]);
    const wrapper = render();
    await open(wrapper);
    expect(find(wrapper, "starter-pack-list-tile-summary-alert").text()).toBe(
      "Crash loops, OOM kills, node memory and cluster capacity",
    );
    await find(wrapper, "starter-pack-list-row-hosts").trigger("click");
    expect(find(wrapper, "starter-pack-list-hero").text()).toContain("Hosts");
    expect(find(wrapper, "starter-pack-list-tile-savedView").text()).toContain("None in this pack");
  });

  it("falls back to the item names on a tile with no summary, and shows Library severity", async () => {
    save([K8S]);
    const wrapper = render();
    await open(wrapper);
    const flow = fake.flows.kubernetes;
    flow.pack.tileSummaries = undefined;
    flow.preview.value = {
      severities: { "k8s/pod_crashloop_backoff": "critical", "k8s/pod_oom_killed": "warning" },
    };
    await find(wrapper, "starter-pack-list-row-kubernetes").trigger("click");
    await flushPromises();
    expect(find(wrapper, "starter-pack-list-tile-summary-alert").text()).toBe(
      "Pod Crashloop Backoff, Pod Oom Killed",
    );
    const badges = find(wrapper, "starter-pack-list-tile-severity").findAll(
      '[data-test^="starter-pack-list-tile-severity-"]',
    );
    expect(badges.map((badge) => badge.text())).toEqual(["1 critical", "1 warning"]);
    expect(badges[0].classes()).toContain("bg-badge-error-soft-bg");
    expect(badges[1].classes()).toContain("bg-badge-warning-soft-bg");
  });

  it("goes from the list to the pack and back, and Back keeps that pack selected", async () => {
    save([K8S, HOSTS]);
    const wrapper = render();
    await open(wrapper);
    await find(wrapper, "starter-pack-list-row-hosts").trigger("click");
    expect(find(wrapper, "starter-pack-list-primary-btn").text()).toBe("Review Pack");
    await find(wrapper, "starter-pack-list-primary-btn").trigger("click");
    expect(find(wrapper, "starter-pack-list").exists()).toBe(true);
    expect(find(wrapper, "starter-pack-list-primary-btn").attributes("disabled")).toBeDefined();
    fake.flows.hosts.previewState.value = "ready";
    await flushPromises();
    expect(find(wrapper, "pane-hosts").attributes("data-back")).toBe("true");
    await find(wrapper, "pane-back").trigger("click");
    expect(find(wrapper, "starter-pack-list").exists()).toBe(true);
    expect(find(wrapper, "starter-pack-list-hero").text()).toContain("Hosts");
  });

  it("opens a set-up pack's View Pack from the list", async () => {
    save([HOSTS], ["kubernetes"]);
    const wrapper = render();
    await open(wrapper);
    await find(wrapper, "starter-pack-list-row-kubernetes").trigger("click");
    expect(find(wrapper, "starter-pack-list-primary-btn").text()).toBe("View Pack");
    await find(wrapper, "starter-pack-list-primary-btn").trigger("click");
    expect(find(wrapper, "pane-kubernetes").exists()).toBe(true);
  });

  it("opens on a pack's review when another surface asks for it", async () => {
    save([K8S, HOSTS]);
    const wrapper = render();
    useStarterPackPopup(ORG).openPack("hosts");
    await flushPromises();
    expect(find(wrapper, "pane-hosts").exists()).toBe(true);
  });

  it("shows progress on the chip while a setup runs, and reopens on Setting up after a close", async () => {
    save([K8S]);
    const wrapper = render();
    await open(wrapper);
    fake.flows.kubernetes.previewState.value = "ready";
    await find(wrapper, "starter-pack-list-primary-btn").trigger("click");
    await flushPromises();
    const flow = fake.flows.kubernetes;
    flow.running.value = true;
    flow.made.value = [{}, {}];
    flow.toCreate.value = [{}, {}, {}, {}];
    await find(wrapper, "pane-close").trigger("click");
    expect(find(wrapper, "stub-popup").exists()).toBe(false);
    expect(find(wrapper, "header-starter-packs-progress").text()).toContain("2 of 4");
    await open(wrapper);
    expect(find(wrapper, "pane-kubernetes").exists()).toBe(true);
  });

  it("says when nothing matches, keeping Check Again (M7)", async () => {
    save([]);
    const wrapper = render();
    await open(wrapper);
    expect(find(wrapper, "starter-pack-list-empty").text()).toContain(
      "No packs match your data yet",
    );
    expect(find(wrapper, "starter-pack-list-subtitle").text()).toBe("No packs match yet");
    expect(find(wrapper, "starter-pack-list-primary-btn").exists()).toBe(false);
    expect(find(wrapper, "starter-pack-list-check-again").exists()).toBe(true);
  });

  it("says a failed Check Again in the footer, with the same action to try again", async () => {
    save([K8S]);
    const wrapper = render();
    await open(wrapper);
    fake.checkState = "error";
    await find(wrapper, "starter-pack-list-check-again").trigger("click");
    await flushPromises();
    expect(find(wrapper, "starter-pack-list-checked").text()).toContain(
      "Couldn't check. Try again",
    );
    fake.checkState = "ready";
    fake.checkResult = { checkedAt: Date.now(), sources: [K8S, HOSTS], dismissed: 0 };
    await find(wrapper, "starter-pack-list-check-again").trigger("click");
    await flushPromises();
    expect(find(wrapper, "starter-pack-list-checked").text()).not.toContain("Couldn't check");
    expect(railIds(wrapper)).toEqual(["kubernetes", "hosts"]);
  });

  it("reads each listed pack's record and the selected pack's plan only once the list shows", async () => {
    save([K8S, HOSTS]);
    const wrapper = render();
    expect(fake.flows.kubernetes.load).not.toHaveBeenCalled();
    await open(wrapper);
    expect(fake.flows.kubernetes.load).toHaveBeenCalled();
    expect(fake.flows.hosts.load).toHaveBeenCalled();
    expect(fake.flows.kubernetes.loadPreview).toHaveBeenCalled();
    expect(fake.flows.hosts.loadPreview).not.toHaveBeenCalled();
  });

  it("reads each pack's record once and joins the selected pack's match, however the rail recomputes", async () => {
    let release!: () => void;
    fake.loadGate = new Promise((done) => (release = done));
    save([K8S, HOSTS, DOCKER]);
    const wrapper = render();
    await open(wrapper);
    await find(wrapper, "starter-pack-list-row-hosts").trigger("click");
    await find(wrapper, "starter-pack-list-row-kubernetes").trigger("click");
    release();
    await flushPromises();
    for (const id of ["kubernetes", "hosts", "docker"]) {
      expect(fake.flows[id].load).toHaveBeenCalledTimes(1);
    }
    for (const matcher of fake.matchers) expect(matcher.check).not.toHaveBeenCalled();
    // Each selection joins the pack's shared match; a pack never selected is not matched.
    const joins = (id: string) =>
      fake.matchers
        .filter(({ packId }) => packId === id)
        .reduce((sum, matcher) => sum + matcher.checkShared.mock.calls.length, 0);
    expect([joins("kubernetes"), joins("hosts"), joins("docker")]).toEqual([2, 1, 0]);
  });

  it("plans a pack the browser copy called set up once its record says it is not", async () => {
    let release = () => {};
    fake.loadGate = new Promise((done) => (release = done));
    save([K8S, HOSTS], ["kubernetes"]);
    delete fake.records.kubernetes;
    const wrapper = render();
    await open(wrapper);
    await find(wrapper, "starter-pack-list-row-kubernetes").trigger("click");
    await flushPromises();
    expect(fake.flows.kubernetes.loadPreview).not.toHaveBeenCalled();
    release();
    await flushPromises();
    expect(fake.flows.kubernetes.loadPreview).toHaveBeenCalledTimes(1);
    const shared = fake.matchers.filter(({ packId }) => packId === "kubernetes");
    expect(shared.some((matcher) => matcher.checkShared.mock.calls.length > 0)).toBe(true);
  });

  it("re-runs the selected pack's shared match when it settled on none before the data", async () => {
    save([K8S, HOSTS]);
    const wrapper = render();
    const shared = fake.matchers.filter(({ packId }) => packId === "kubernetes");
    expect(shared).not.toHaveLength(0);
    for (const matcher of shared) matcher.state.value = "none";
    await open(wrapper);
    expect(shared.some((matcher) => matcher.checkShared.mock.calls.length > 0)).toBe(true);
  });

  it("reads the record of a pack a check adds while the list is open", async () => {
    save([K8S]);
    const wrapper = render();
    await open(wrapper);
    expect(fake.flows.hosts.load).not.toHaveBeenCalled();
    save([K8S, HOSTS]);
    await flushPromises();
    expect(fake.flows.hosts.load).toHaveBeenCalledTimes(1);
  });
});
