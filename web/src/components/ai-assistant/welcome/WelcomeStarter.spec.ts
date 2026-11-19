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
import { nextTick, ref, shallowRef } from "vue";

import i18n from "@/locales";
import { fakeFlow } from "@/components/starterPacks/starterPackTestFlow";
import { packById } from "@/composables/starterPacks/usePackCatalog";
import { PACK_DIGEST_NAME } from "@/composables/starterPacks/packDigest";
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

import { starterSuggestions, starterWelcomeMode, type WelcomeContext } from "./starterWelcome";
import WelcomeStarter from "./WelcomeStarter.vue";

loadCatalogFixture();

const fake = vi.hoisted(() => ({
  visible: null as any,
  showSection: null as any,
  loading: null as any,
  offered: null as any,
}));
vi.mock("@/composables/starterPacks/usePackGate", () => ({
  usePackGate: () => ({ visible: fake.visible }),
}));
vi.mock("@/composables/starterPacks/useHomePacks", () => ({
  useHomePacks: () => ({
    showSection: fake.showSection,
    loading: fake.loading,
    offered: fake.offered,
  }),
}));

const itemOf = (id: string) => {
  const pack = packById(id)!;
  return { pack, title: pack.title, matcher: { streams: ref([]) }, flow: fakeFlow({ pack }) };
};

const render = () =>
  mount(WelcomeStarter, {
    props: { org: "org" },
    global: { plugins: [i18n], stubs: { OIcon: true } },
  });

const { t } = i18n.global as unknown as { t: Parameters<typeof starterSuggestions>[0] };

describe("starterWelcomeMode", () => {
  it("is starter only when the Home offer would show", () => {
    expect(starterWelcomeMode({ visible: true, showSection: true, loading: false })).toBe(
      "starter",
    );
    expect(starterWelcomeMode({ visible: true, showSection: false, loading: true })).toBe(
      "loading",
    );
    expect(starterWelcomeMode({ visible: true, showSection: false, loading: false })).toBe("none");
    expect(starterWelcomeMode({ visible: false, showSection: true, loading: true })).toBe("none");
  });
});

describe("starterSuggestions", () => {
  it("names the top two packs", () => {
    const texts = starterSuggestions(t, ["Kubernetes", "Hosts"]).map(({ text }) => text);
    expect(texts).toEqual([
      "Which starter packs fit my data?",
      "Set up the Kubernetes pack",
      "What is in the Hosts pack?",
      'Map my "default" stream schema',
      "Show me errors from the last hour",
      "Convert this Datadog query to OpenObserve SQL",
    ]);
  });

  it("names the one pack twice rather than a missing one", () => {
    const texts = starterSuggestions(t, ["Hosts"]).map(({ text }) => text);
    expect(texts[1]).toBe("Set up the Hosts pack");
    expect(texts[2]).toBe("What is in the Hosts pack?");
    expect(texts.join(" ")).not.toContain("undefined");
  });
});

describe("WelcomeStarter", () => {
  beforeEach(() => {
    fake.visible = ref(true);
    fake.showSection = ref(false);
    fake.loading = ref(false);
    fake.offered = shallowRef([itemOf("kubernetes"), itemOf("hosts"), itemOf("postgresql")]);
  });

  it("draws nothing and hands back today's welcome when not in starter mode", () => {
    const wrapper = render();
    expect(wrapper.emitted("mode")![0]).toEqual(["none"]);
    expect(wrapper.find('[data-test="o2-ai-welcome-card-starter"]').exists()).toBe(false);
    expect(wrapper.emitted("context")).toEqual([[null]]);
  });

  it("shows placeholders with the checking line while packs load", () => {
    fake.loading.value = true;
    const wrapper = render();
    expect(wrapper.emitted("mode")![0]).toEqual(["loading"]);
    const loading = wrapper.find('[data-test="o2-ai-welcome-starter-loading"]');
    expect(loading.text()).toContain("Checking your data for starter packs…");
  });

  it("leads with the Starter Packs card, drops Investigate Incidents and sends the digest", async () => {
    fake.showSection.value = true;
    const wrapper = render();
    expect(wrapper.emitted("mode")![0]).toEqual(["starter"]);
    const cards = wrapper.findAll('[data-test^="o2-ai-welcome-card-"][role="button"]');
    expect(cards.map((card) => card.attributes("data-test"))).toEqual([
      "o2-ai-welcome-card-starter",
      "o2-ai-welcome-card-query",
      "o2-ai-welcome-card-dashboard",
      "o2-ai-welcome-card-alert",
    ]);
    expect(cards[0].text()).toContain("Set up Starter Packs");
    expect(cards[0].text()).toContain("Best place to start");
    expect(cards[0].text()).toContain(
      "Dashboards, alerts and saved views built for your Kubernetes, Hosts and PostgreSQL data.",
    );

    const sent = wrapper.emitted("context")!;
    expect(sent).toHaveLength(1);
    const context = sent[0][0] as WelcomeContext;
    expect(context.name).toBe(PACK_DIGEST_NAME);
    expect(context.text.split("\n")[0]).toBe(
      "Starter packs for your data: Kubernetes, Hosts, PostgreSQL",
    );
  });

  it("sends a new digest when previews add counts, and null when starter mode ends or it unmounts", async () => {
    fake.showSection.value = true;
    const count = ref<number | null>(null);
    const item = { ...itemOf("kubernetes") };
    item.flow = fakeFlow({ pack: item.pack, dashboardCount: count });
    fake.offered = shallowRef([item]);
    const wrapper = render();
    expect((wrapper.emitted("context")![0][0] as WelcomeContext).text).not.toContain("Creates:");
    count.value = 1;
    await nextTick();
    expect((wrapper.emitted("context")!.at(-1)![0] as WelcomeContext).text).toContain(
      "Creates: 1 dashboard",
    );
    fake.showSection.value = false;
    await nextTick();
    expect(wrapper.emitted("context")!.at(-1)).toEqual([null]);
    fake.showSection.value = true;
    await nextTick();
    wrapper.unmount();
    expect(wrapper.emitted("context")!.at(-1)).toEqual([null]);
  });

  it("fills the composer with the card's question and the digest chip, never sending", async () => {
    fake.showSection.value = true;
    const wrapper = render();
    await wrapper.find('[data-test="o2-ai-welcome-card-starter"]').trigger("click");
    const [prompt, context] = wrapper.emitted("select")![0] as [string, WelcomeContext];
    expect(prompt).toBe("Which starter packs fit my data, and what will each one create?");
    expect(context.name).toBe(PACK_DIGEST_NAME);
  });

  it("ends starter mode by itself once the org has resources", async () => {
    fake.showSection.value = true;
    const wrapper = render();
    fake.showSection.value = false;
    await nextTick();
    expect(wrapper.emitted("mode")!.at(-1)).toEqual(["none"]);
    expect(wrapper.find('[data-test="o2-ai-welcome-card-starter"]').exists()).toBe(false);
  });
});
