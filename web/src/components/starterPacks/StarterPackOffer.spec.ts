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
import { defineComponent, h, nextTick, ref, shallowRef } from "vue";

import i18n from "@/locales";
import { PACK_DIGEST_CHIP_ID } from "@/components/ai-assistant/welcome/starterWelcome";
import { fakeFlow } from "@/components/starterPacks/starterPackTestFlow";
import { packById } from "@/composables/starterPacks/usePackCatalog";
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

import StarterPackOffer from "./StarterPackOffer.vue";

loadCatalogFixture();

const fake = vi.hoisted(() => ({
  visible: null as any,
  showSection: null as any,
  loading: null as any,
  askAdmin: null as any,
  noAccess: null as any,
  offered: null as any,
}));
vi.mock("@/composables/starterPacks/usePackGate", () => ({
  usePackGate: () => ({ visible: fake.visible }),
}));
vi.mock("@/composables/starterPacks/useHomePacks", () => ({
  useHomePacks: () => ({
    showSection: fake.showSection,
    loading: fake.loading,
    askAdmin: fake.askAdmin,
    noAccess: fake.noAccess,
    offered: fake.offered,
  }),
}));

// The real popover reads the org's members; the stub keeps the kind it was opened for.
const AskAdminStub = defineComponent({
  name: "AssistantAskAdminPopover",
  props: { kind: String, org: String },
  setup(props, { slots }) {
    return () => h("span", { "data-kind": props.kind }, slots.trigger?.());
  },
});

const itemOf = (id: string, over: Record<string, unknown> = {}, view = "offer") => {
  const pack = packById(id)!;
  return {
    pack,
    title: pack.title,
    view: ref(view),
    matcher: { streams: ref([]) },
    flow: fakeFlow({ pack, ...over }),
    openDetails: vi.fn(),
  };
};

const render = (variant: "compact" | "roomy" = "compact") =>
  mount(StarterPackOffer, {
    props: { org: "org", variant },
    global: {
      plugins: [i18n],
      stubs: { OIcon: true, AssistantAskAdminPopover: AskAdminStub },
    },
  });

const lastDigest = (wrapper: ReturnType<typeof render>) =>
  wrapper.emitted("digest")!.at(-1)![0] as string | null;

beforeEach(() => {
  fake.visible = ref(true);
  fake.showSection = ref(false);
  fake.loading = ref(false);
  fake.askAdmin = ref(false);
  fake.noAccess = ref(false);
  fake.offered = shallowRef([itemOf("kubernetes"), itemOf("hosts"), itemOf("postgresql")]);
});

describe("StarterPackOffer", () => {
  it("draws nothing and sends no digest when packs are not offered", () => {
    const wrapper = render();
    expect(wrapper.find('[data-test="assistant-pack-offer"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-pack-offer-loading"]').exists()).toBe(false);
    expect(wrapper.emitted("digest")).toEqual([[null]]);
  });

  it("holds the space with the checking line while packs load", () => {
    fake.loading.value = true;
    const wrapper = render();
    const loading = wrapper.find('[data-test="assistant-pack-offer-loading"]');
    expect(loading.text()).toContain("Checking your data for starter packs…");
    expect(loading.findAll("li")).toHaveLength(3);
    expect(lastDigest(wrapper)).toBeNull();
  });

  it("lists each matched pack with its counts and a Review pack button", async () => {
    fake.showSection.value = true;
    const wrapper = render();
    const offer = wrapper.find('[data-test="assistant-pack-offer"]');
    expect(offer.text()).toContain("Starter packs for your data");
    expect(offer.text()).toContain("3 fit your streams");
    expect(wrapper.find('[data-test="assistant-pack-offer-note-kubernetes"]').text()).toBe(
      "1 dashboard · 2 alerts · 1 saved view",
    );
    await wrapper.find('[data-test="assistant-pack-offer-review-hosts"]').trigger("click");
    expect(fake.offered.value[1].openDetails).toHaveBeenCalledTimes(1);
  });

  it("sends the digest while packs are offered", () => {
    fake.showSection.value = true;
    const wrapper = render();
    expect(lastDigest(wrapper)!.split("\n")[0]).toBe(
      "Starter packs for your data: Kubernetes, Hosts, PostgreSQL",
    );
  });

  it("sends a new digest when previews add counts, and null when the offer ends or unmounts", async () => {
    fake.showSection.value = true;
    const count = ref<number | null>(null);
    fake.offered = shallowRef([itemOf("kubernetes", { dashboardCount: count })]);
    const wrapper = render();
    expect(lastDigest(wrapper)).not.toContain("Creates:");
    count.value = 1;
    await nextTick();
    expect(lastDigest(wrapper)).toContain("Creates: 1 dashboard");
    fake.showSection.value = false;
    await nextTick();
    expect(lastDigest(wrapper)).toBeNull();
    fake.showSection.value = true;
    await nextTick();
    wrapper.unmount();
    expect(lastDigest(wrapper)).toBeNull();
  });

  it("asks an admin through the access request when packs fit but the user cannot set them up", () => {
    fake.askAdmin.value = true;
    const wrapper = render();
    const offer = wrapper.find('[data-test="assistant-pack-offer"]');
    expect(offer.attributes("data-mode")).toBe("askAdmin");
    expect(offer.text()).toContain("Kubernetes, Hosts, and PostgreSQL");
    expect(offer.find('[data-test="assistant-pack-offer-review-kubernetes"]').exists()).toBe(false);
    const ask = wrapper.find('[data-test="assistant-pack-offer-ask-admin"]');
    expect(ask.element.closest("[data-kind]")!.getAttribute("data-kind")).toBe("access");
    expect(lastDigest(wrapper)).toBeNull();
  });

  it("keeps today's welcome when the data check itself was refused", () => {
    fake.askAdmin.value = true;
    fake.noAccess.value = true;
    const wrapper = render();
    expect(wrapper.find('[data-test="assistant-pack-offer"]').exists()).toBe(false);
  });

  it("on Home, opens a pack from its card and hands the question with the digest to the box", async () => {
    fake.showSection.value = true;
    const wrapper = render("roomy");
    await wrapper.find('[data-test="assistant-home-pack-kubernetes"]').trigger("click");
    expect(fake.offered.value[0].openDetails).toHaveBeenCalledTimes(1);
    await wrapper.find('[data-test="assistant-home-pack-offer-ask"]').trigger("click");
    const [prompt, chip] = wrapper.emitted("ask")![0] as [string, { id: string; data: string }];
    expect(prompt).toBe("Which starter packs fit my data, and what will each one create?");
    expect(chip.id).toBe(PACK_DIGEST_CHIP_ID);
    expect(chip.data).toBe(lastDigest(wrapper));
  });

  it("draws nothing while the org's pack gate is closed", () => {
    fake.visible.value = false;
    fake.showSection.value = true;
    const wrapper = render();
    expect(wrapper.find('[data-test="assistant-pack-offer"]').exists()).toBe(false);
    expect(lastDigest(wrapper)).toBeNull();
  });

  it("asks an admin for a pack this user may not set up, and leaves it out of the digest", () => {
    fake.showSection.value = true;
    fake.offered = shallowRef([itemOf("kubernetes"), itemOf("hosts", {}, "forbidden")]);
    const wrapper = render();
    expect(wrapper.find('[data-test="assistant-pack-offer-review-kubernetes"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="assistant-pack-offer-review-hosts"]').exists()).toBe(false);
    const ask = wrapper.get('[data-test="assistant-pack-offer-ask-admin-hosts"]');
    expect(ask.element.closest("[data-kind]")!.getAttribute("data-kind")).toBe("access");
    expect(lastDigest(wrapper)!.split("\n")[0]).toBe("Starter packs for your data: Kubernetes");
    expect(lastDigest(wrapper)).not.toContain("(id: hosts)");
  });

  it("on Home, names the packs that fit and asks an admin when the user cannot set them up", () => {
    fake.askAdmin.value = true;
    const wrapper = render("roomy");
    const offer = wrapper.get('[data-test="assistant-home-pack-offer"]');
    expect(offer.attributes("data-mode")).toBe("askAdmin");
    expect(offer.text()).toContain("Kubernetes, Hosts, and PostgreSQL fit your data");
    expect(offer.text()).toContain("dashboards, alerts and saved views in total");
    const ask = wrapper.get('[data-test="assistant-pack-offer-ask-admin"]');
    expect(ask.element.closest("[data-kind]")!.getAttribute("data-kind")).toBe("access");
    expect(wrapper.find('[data-test="assistant-home-pack-offer-ask"]').exists()).toBe(false);
  });
});
