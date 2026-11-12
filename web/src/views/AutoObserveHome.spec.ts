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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, inject, ref } from "vue";
import { ASK_AI_KEY, type InsightAskPayload } from "@/components/autoobserve/insight/insightCta";
import AutoObserveHome from "./AutoObserveHome.vue";

const view = ref<"standard" | "nerd">("standard");
vi.mock("@/components/autoobserve/v2/useAutoObserveView", () => ({
  useAutoObserveView: () => ({ view }),
}));
vi.mock("@/components/autoobserve/data/useScenario", () => ({
  useScenario: () => ({ scenario: ref("default") }),
}));
vi.mock("@/components/autoobserve/live/liveModel", () => ({ useFixtureMode: () => ref(false) }));

// A card deep in either view asks through the injected key, never through an emit chain.
const DeepCard = defineComponent({
  setup() {
    const ask = inject(ASK_AI_KEY, null);
    return () =>
      h("button", {
        "data-test": "deep-ask",
        onClick: () => ask?.(PAYLOAD),
      });
  },
});

const PAYLOAD: InsightAskPayload = {
  query: "facts",
  prompt: "request",
  chipName: "AutoObserve finding · checkout",
  newChat: true,
  autoSend: false,
  context: { currentPage: "autoobserve", org_id: "demo-org" },
};

const mountHome = () =>
  mount(AutoObserveHome, {
    global: {
      stubs: {
        AutoObserve: { name: "AutoObserve", render: () => h("div", [h(DeepCard)]) },
        AutoObserve2: { name: "AutoObserve2", render: () => h("div", [h(DeepCard)]) },
        BulkReviewDrawer: { name: "BulkReviewDrawer", render: () => h("aside") },
      },
    },
  });

describe("AutoObserveHome", () => {
  it.each(["standard", "nerd"] as const)(
    "Ask AI from a card in the %s view reaches the chat binding unchanged",
    async (mode) => {
      view.value = mode;
      const w = mountHome();
      await w.find('[data-test="deep-ask"]').trigger("click");
      expect(w.emitted("sendToAiChat")).toEqual([[PAYLOAD]]);
      w.unmount();
    },
  );

  it.each(["standard", "nerd"] as const)(
    "the bulk review drawer is mounted in the %s view, so its production entry point works",
    (mode) => {
      view.value = mode;
      const w = mountHome();
      expect(w.findComponent({ name: "BulkReviewDrawer" }).exists()).toBe(true);
      w.unmount();
    },
  );
});
