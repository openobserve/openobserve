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
import { nextTick, ref } from "vue";

import i18n from "@/locales";
import { packById } from "@/composables/starterPacks/usePackCatalog";
import { resetStarterPackPopups } from "@/composables/starterPacks/useStarterPackPopup";
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

import StarterPackChatRows from "./StarterPackChatRows.vue";
import { fakeFlow } from "./starterPackTestFlow";

loadCatalogFixture();

// useHomePacks runs for real; only the pack state, org answers and browser copy are doubles.
const fake = vi.hoisted(() => ({
  flows: {} as Record<string, any>,
  matchers: {} as Record<string, any>,
  hasUserData: null as any,
  noResources: null as any,
  browser: { saveBuiltIn: vi.fn(), markInstalled: vi.fn() },
}));
vi.mock("@/composables/starterPacks/useStarterPackFlow", () => ({
  useStarterPackFlow: (_org: string, pack: { id: string }) => fake.flows[pack.id],
}));
vi.mock("@/composables/starterPacks/useStarterPackMatcher", () => ({
  useStarterPackMatcher: (_org: string, { pack }: { pack: { id: string } }) =>
    fake.matchers[pack.id],
}));
vi.mock("@/composables/useOrgHasUserData", () => ({
  useOrgHasUserData: () => ({ hasUserData: fake.hasUserData }),
}));
vi.mock("@/composables/useOrgResources", () => ({
  useOrgHasNoResources: () => ({ noResources: fake.noResources }),
}));
vi.mock("@/composables/starterPacks/useBrowserMatches", () => ({
  useBrowserMatches: () => fake.browser,
}));
vi.mock("@/composables/starterPacks/usePackGate", async () => {
  const { computed } = await import("vue");
  return { usePackGate: () => ({ visible: computed(() => true) }) };
});

const matcherDouble = (state = "matched") => {
  const check = vi.fn();
  return {
    state: ref(state),
    forbidden: ref(false),
    clusters: ref<string[]>([]),
    streams: ref(["k8s_events"]),
    waitedLong: ref(false),
    check,
    checkShared: check,
    retry: vi.fn(async () => undefined),
  };
};

const IDS = ["kubernetes", "hosts", "docker"];

const render = async (packIds = ["kubernetes", "hosts"]) => {
  const wrapper = mount(StarterPackChatRows, {
    props: { org: "org", packIds },
    global: { plugins: [i18n], stubs: { OIcon: true } },
  });
  await flushPromises();
  return wrapper;
};
type Wrapper = Awaited<ReturnType<typeof render>>;
const has = (wrapper: Wrapper, id: string) => wrapper.find(`[data-test="${id}"]`).exists();

describe("StarterPackChatRows", () => {
  beforeEach(() => {
    resetStarterPackPopups();
    fake.flows = Object.fromEntries(IDS.map((id) => [id, fakeFlow({ pack: packById(id)! })]));
    fake.matchers = Object.fromEntries(IDS.map((id) => [id, matcherDouble()]));
    fake.hasUserData = ref(true);
    fake.noResources = ref(true);
    fake.browser.saveBuiltIn.mockClear();
    fake.browser.markInstalled.mockClear();
  });

  it("never overwrites the org's saved match copy with the digest's packs", async () => {
    const wrapper = await render(["kubernetes"]);
    expect(has(wrapper, "starter-pack-chat-row-kubernetes")).toBe(true);
    expect(fake.browser.saveBuiltIn).not.toHaveBeenCalled();
  });

  it("draws a row per pack on offer, with the badge on the first one", async () => {
    fake.matchers.docker.state.value = "none";
    const wrapper = await render(IDS);
    expect(wrapper.text()).toContain("Ready when you are:");
    expect(has(wrapper, "starter-pack-chat-row-kubernetes")).toBe(true);
    expect(has(wrapper, "starter-pack-chat-row-hosts")).toBe(true);
    expect(has(wrapper, "starter-pack-chat-row-docker")).toBe(false);
    expect(has(wrapper, "starter-pack-chat-best-kubernetes")).toBe(true);
    expect(has(wrapper, "starter-pack-chat-best-hosts")).toBe(false);
    expect(wrapper.get('[data-test="starter-pack-chat-set-up-kubernetes"]').text()).toBe(
      "Set up 4 items",
    );
  });

  it("sets up through the flow with alerts off and opens the review from the link", async () => {
    const wrapper = await render(["kubernetes"]);
    await wrapper.get('[data-test="starter-pack-chat-set-up-kubernetes"]').trigger("click");
    await flushPromises();
    expect(fake.flows.kubernetes.install).toHaveBeenCalledWith(undefined, {
      exclude: [],
      enableAlerts: false,
    });
    expect(fake.browser.markInstalled).toHaveBeenCalledWith("kubernetes", "kubernetes");
    await wrapper.get('[data-test="starter-pack-chat-review-kubernetes"]').trigger("click");
    expect(fake.matchers.kubernetes.checkShared).toHaveBeenCalled();
  });

  it("says who is setting the pack up when the chat Set up was stopped by another install", async () => {
    const wrapper = await render(["kubernetes"]);
    const flow = fake.flows.kubernetes;
    flow.install = vi.fn(async () => {
      flow.busyBy.value = "first@example.com";
      return false;
    });
    await wrapper.get('[data-test="starter-pack-chat-set-up-kubernetes"]').trigger("click");
    await flushPromises();
    const note = () => wrapper.get('[data-test="starter-pack-chat-note-kubernetes"]').text();
    expect(note()).toBe(
      "first@example.com is setting this pack up right now. Check back in a minute.",
    );
    flow.busyBy.value = "";
    await nextTick();
    expect(note()).toBe("Someone else is setting this pack up right now. Check back in a minute.");
    expect(fake.browser.markInstalled).not.toHaveBeenCalled();
  });

  it("keeps the set up pack ready, drops the other offers and the badge once the offer ends", async () => {
    const wrapper = await render();
    fake.flows.kubernetes.record.value = { status: "complete", items: [] };
    fake.flows.kubernetes.installed.value = true;
    fake.flows.kubernetes.dashboardItem.value = { id: "d1", kind: "dashboard" };
    fake.noResources.value = false;
    await nextTick();
    expect(wrapper.get('[data-test="starter-pack-chat-note-kubernetes"]').text()).toBe(
      "Kubernetes monitoring is ready",
    );
    expect(has(wrapper, "starter-pack-chat-undo-kubernetes")).toBe(true);
    expect(wrapper.get('[data-test="starter-pack-chat-open-kubernetes"]').text()).toBe(
      "Open dashboard",
    );
    expect(has(wrapper, "starter-pack-chat-row-hosts")).toBe(false);
    expect(has(wrapper, "starter-pack-chat-best-kubernetes")).toBe(false);
  });

  it("closes the Undo confirm and offers the pack again once undo finishes", async () => {
    const flow = fake.flows.kubernetes;
    flow.record.value = { status: "complete", items: [], installedAt: Date.now() * 1000 };
    flow.installed.value = true;
    fake.noResources.value = false;
    // As the real flow does: the record goes, then the org summary refresh makes the org empty again.
    flow.undo = vi.fn(async () => {
      flow.record.value = null;
      flow.installed.value = false;
      await nextTick();
      fake.noResources.value = true;
      return true;
    });
    const wrapper = await render(["kubernetes"]);
    await wrapper.get('[data-test="starter-pack-chat-undo-kubernetes"]').trigger("click");
    await wrapper.get('[data-test="starter-pack-undo-confirm-btn"]').trigger("click");
    await flushPromises();
    expect(flow.undo).toHaveBeenCalled();
    expect(has(wrapper, "starter-pack-undo-confirm-btn")).toBe(false);
    expect(wrapper.get('[data-test="starter-pack-chat-set-up-kubernetes"]').text()).toBe(
      "Set up 4 items",
    );
    expect(has(wrapper, "starter-pack-chat-review-kubernetes")).toBe(true);
  });

  it("drops the badge from the other offers while one pack is being set up", async () => {
    const wrapper = await render();
    fake.flows.kubernetes.running.value = true;
    await nextTick();
    expect(has(wrapper, "starter-pack-chat-row-hosts")).toBe(true);
    expect(has(wrapper, "starter-pack-chat-best-hosts")).toBe(false);
  });

  it("offers Retry on a partial set up", async () => {
    fake.flows.hosts.record.value = { status: "incomplete", items: [] };
    fake.flows.hosts.interrupted.value = true;
    fake.flows.hosts.failed.value = [{}, {}];
    const wrapper = await render();
    expect(wrapper.get('[data-test="starter-pack-chat-retry-hosts"]').text()).toBe("Retry 2 items");
  });

  it("asks for an admin instead of offering the button", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    const wrapper = await render(["kubernetes"]);
    expect(wrapper.get('[data-test="starter-pack-chat-note-kubernetes"]').text()).toBe(
      "Ask an admin to set this up",
    );
    expect(has(wrapper, "starter-pack-chat-set-up-kubernetes")).toBe(false);
  });

  it("draws nothing on a reloaded chat once the org is past the offer", async () => {
    fake.noResources.value = false;
    const wrapper = await render();
    expect(has(wrapper, "starter-pack-chat-rows")).toBe(false);
  });
});
