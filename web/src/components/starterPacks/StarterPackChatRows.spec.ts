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
import { defineComponent, h, nextTick, ref } from "vue";

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
  useOrgHasUserData: () => ({ hasUserData: fake.hasUserData, isFetching: ref(false) }),
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

// The real popover reads the org's members; the stub keeps the kind it was opened for.
const AskAdminStub = defineComponent({
  name: "AssistantAskAdminPopover",
  props: { kind: String, org: String },
  setup(props, { slots }) {
    return () => h("span", { "data-kind": props.kind }, slots.trigger?.());
  },
});

const render = async (packIds = ["kubernetes", "hosts"]) => {
  const wrapper = mount(StarterPackChatRows, {
    props: { org: "org", packIds },
    global: { plugins: [i18n], stubs: { OIcon: true, AssistantAskAdminPopover: AskAdminStub } },
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

  it("draws a row per pack on offer, with no badge", async () => {
    fake.matchers.docker.state.value = "none";
    const wrapper = await render(IDS);
    expect(wrapper.text()).toContain("Ready when you are");
    expect(has(wrapper, "starter-pack-chat-row-kubernetes")).toBe(true);
    expect(has(wrapper, "starter-pack-chat-row-hosts")).toBe(true);
    expect(has(wrapper, "starter-pack-chat-row-docker")).toBe(false);
    expect(wrapper.find('[data-test^="starter-pack-chat-best-"]').exists()).toBe(false);
    // The title column keeps a floor, so the buttons wrap below it rather than squeeze it away.
    const title = wrapper.get('[data-test="starter-pack-chat-note-kubernetes"]').element
      .parentElement!;
    expect(title.classList).toContain("min-w-32");
    expect(title.parentElement!.classList).toContain("flex-wrap");
    expect(wrapper.get('[data-test="starter-pack-chat-set-up-kubernetes"]').text()).toBe(
      "Set up 4 items",
    );
    expect(wrapper.get('[data-test="starter-pack-chat-note-kubernetes"]').text()).toBe(
      "1 dashboard · 2 alerts · 1 saved view",
    );
    expect(
      wrapper.get('[data-test="starter-pack-chat-row-kubernetes"]').attributes("data-state"),
    ).toBe("idle");
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

  it("keeps the pressed Set up button until the claim is held, and shows no error for a refusal", async () => {
    const wrapper = await render(["kubernetes"]);
    const flow = fake.flows.kubernetes;
    flow.claimed.value = false;
    let refuse!: () => void;
    flow.install = vi.fn(async () => {
      flow.running.value = true;
      await new Promise<void>((done) => (refuse = done));
      flow.running.value = false;
      return false;
    });
    const button = () => wrapper.get('[data-test="starter-pack-chat-set-up-kubernetes"]');
    const pressed = button().element;
    await button().trigger("click");
    await flushPromises();
    expect(button().element).toBe(pressed);
    expect(button().attributes("aria-busy")).toBe("true");
    refuse();
    await flushPromises();
    expect(button().element).toBe(pressed);
    expect(wrapper.get('[data-test="starter-pack-chat-note-kubernetes"]').text()).not.toContain(
      "Setup didn't finish",
    );
    flow.running.value = true;
    flow.claimed.value = true;
    await nextTick();
    expect(has(wrapper, "starter-pack-chat-set-up-kubernetes")).toBe(false);
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
    flow.busyBy.value = "user@example.com";
    await nextTick();
    expect(note()).toBe("You are setting this pack up in another tab. Check back in a minute.");
    expect(fake.browser.markInstalled).not.toHaveBeenCalled();
  });

  it("keeps the set up pack ready and drops the other offers once the offer ends", async () => {
    const wrapper = await render();
    fake.flows.kubernetes.record.value = { status: "complete", items: [] };
    fake.flows.kubernetes.installed.value = true;
    fake.flows.kubernetes.dashboardItem.value = { id: "d1", kind: "dashboard" };
    fake.noResources.value = false;
    await nextTick();
    expect(wrapper.get('[data-test="starter-pack-chat-note-kubernetes"]').text()).toBe(
      "Kubernetes monitoring is ready",
    );
    expect(wrapper.text()).not.toMatch(/undo|remove pack/i);
    expect(wrapper.find('[data-test*="-undo-"], [data-test*="-remove-"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="starter-pack-chat-open-kubernetes"]').text()).toBe(
      "Open dashboard",
    );
    expect(has(wrapper, "starter-pack-chat-row-hosts")).toBe(false);
    expect(
      wrapper.get('[data-test="starter-pack-chat-row-kubernetes"]').attributes("data-state"),
    ).toBe("ready");
    expect(wrapper.text()).not.toContain("Ready when you are");
  });

  it("offers Retry on a partial set up", async () => {
    fake.flows.hosts.record.value = { status: "incomplete", items: [] };
    fake.flows.hosts.interrupted.value = true;
    fake.flows.hosts.failed.value = [{}, {}];
    const wrapper = await render();
    expect(wrapper.get('[data-test="starter-pack-chat-retry-hosts"]').text()).toBe("Retry 2 items");
  });

  it("offers Retry on a partial set up someone else started, and names them", async () => {
    fake.flows.hosts.record.value = { status: "incomplete", items: [] };
    fake.flows.hosts.interrupted.value = true;
    fake.flows.hosts.interruptedBy = ref("other@example.com");
    fake.flows.hosts.failed.value = [{}, {}];
    const wrapper = await render();
    expect(wrapper.get('[data-test="starter-pack-chat-retry-hosts"]').text()).toBe("Retry 2 items");
    const note = () => wrapper.get('[data-test="starter-pack-chat-note-hosts"]').text();
    expect(note()).toBe("other@example.com started setting up this pack.");
    fake.flows.hosts.interruptedBy.value = "";
    await nextTick();
    expect(note()).toBe("Someone else started setting up this pack.");
  });

  it("lets anyone who may set up finish a stopped setup someone else started", async () => {
    fake.flows.hosts.record.value = { status: "installing", items: [] };
    fake.flows.hosts.interrupted.value = true;
    fake.flows.hosts.interruptedBy = ref("other@example.com");
    const wrapper = await render(["hosts"]);
    expect(wrapper.get('[data-test="starter-pack-chat-row-hosts"]').attributes("data-state")).toBe(
      "failed",
    );
    expect(wrapper.get('[data-test="starter-pack-chat-retry-hosts"]').text()).toBe("Finish");
    await wrapper.get('[data-test="starter-pack-chat-retry-hosts"]').trigger("click");
    expect(fake.flows.hosts.retry).toHaveBeenCalled();
  });

  it("says who is running a setup elsewhere, with no Set up or Finish", async () => {
    fake.flows.hosts.record.value = { status: "installing", items: [] };
    fake.flows.hosts.runningBy.value = "other@example.com";
    const wrapper = await render();
    expect(has(wrapper, "starter-pack-chat-retry-hosts")).toBe(false);
    expect(has(wrapper, "starter-pack-chat-set-up-hosts")).toBe(false);
    expect(wrapper.get('[data-test="starter-pack-chat-note-hosts"]').text()).toBe(
      "other@example.com is setting this pack up right now. Check back in a minute.",
    );
  });

  it("asks an admin through the access request instead of offering the button", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    const wrapper = await render(["kubernetes"]);
    expect(
      wrapper.get('[data-test="starter-pack-chat-row-kubernetes"]').attributes("data-state"),
    ).toBe("forbidden");
    expect(wrapper.get('[data-test="starter-pack-chat-note-kubernetes"]').text()).toBe(
      "1 dashboard · 2 alerts · 1 saved view",
    );
    expect(has(wrapper, "starter-pack-chat-set-up-kubernetes")).toBe(false);
    const ask = wrapper.get('[data-test="starter-pack-chat-ask-admin-kubernetes"]');
    expect(ask.text()).toBe("Ask an admin");
    expect(ask.element.closest("[data-kind]")!.getAttribute("data-kind")).toBe("access");
    expect(wrapper.text()).not.toContain("Ready when you are");
  });

  it("shows the setup in this tab with no buttons", async () => {
    fake.flows.kubernetes.running.value = true;
    const wrapper = await render(["kubernetes"]);
    expect(
      wrapper.get('[data-test="starter-pack-chat-row-kubernetes"]').attributes("data-state"),
    ).toBe("settingUp");
    expect(wrapper.find('[data-test="starter-pack-chat-row-kubernetes"] button').exists()).toBe(
      false,
    );
  });

  it("draws nothing on a reloaded chat once the org is past the offer", async () => {
    fake.noResources.value = false;
    const wrapper = await render();
    expect(has(wrapper, "starter-pack-chat-rows")).toBe(false);
  });
});
