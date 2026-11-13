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

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { h, reactive, ref } from "vue";
import type { RouteLocationNormalized } from "vue-router";
import type { InsightAskPayload } from "@/components/autoobserve/insight/insightCta";
import { keepLiveMode, liveQuery } from "@/components/autoobserve/v2/autoobserveRoute";
import AutoObserveHome from "./AutoObserveHome.vue";

const view = ref<"standard" | "nerd">("standard");
vi.mock("@/components/autoobserve/v2/useAutoObserveView", () => ({
  useAutoObserveView: () => ({ view }),
}));

const route = reactive<{ query: Record<string, string> }>({ query: {} });
vi.mock("vue-router", async (original) => ({
  ...(await original<typeof import("vue-router")>()),
  useRoute: () => route,
  onBeforeRouteUpdate: vi.fn(),
}));

const PAYLOAD = vi.hoisted((): InsightAskPayload => ({
  query: "facts",
  prompt: "request",
  chipName: "AutoObserve finding · checkout",
  newChat: true,
  autoSend: false,
  context: { currentPage: "autoobserve", org_id: "demo-org" },
}));

// A card deep in either view asks through the injected key, never through an emit chain.
const pageStub = vi.hoisted(() => async (page: string) => {
  const { defineComponent, h, inject } = await import("vue");
  const { ASK_AI_KEY } = await import("@/components/autoobserve/insight/insightCta");
  // defineAsyncComponent unwraps `default` only from a module, which a mock factory object is not.
  return {
    __esModule: true,
    default: defineComponent({
      setup() {
        const ask = inject(ASK_AI_KEY, null);
        return () =>
          h("button", {
            "data-test": "deep-ask",
            "data-page": page,
            onClick: () => ask?.(PAYLOAD),
          });
      },
    }),
  };
});
vi.mock("@/views/AutoObserve.vue", () => pageStub("live"));
vi.mock("@/views/AutoObserve2.vue", () => pageStub("live"));
vi.mock("@/components/autoobserve/mock/data/facts", () => ({ factsReady: Promise.resolve() }));
vi.mock("@/components/autoobserve/mock/views/AutoObserveMockHome.vue", () => pageStub("sample"));

const mountHome = async (query: Record<string, string>) => {
  route.query = query;
  const w = mount(AutoObserveHome, {
    global: {
      stubs: { BulkReviewDrawer: { name: "BulkReviewDrawer", render: () => h("aside") } },
    },
  });
  await vi.waitFor(() => expect(w.find('[data-test="deep-ask"]').exists()).toBe(true));
  return w;
};

const at = (query: Record<string, string>) => ({ path: "/autoobserve", hash: "", query });

describe("AutoObserveHome", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [{}, "sample"],
    [{ live: "0" }, "sample"],
    [{ fixture: "1" }, "sample"],
    [{ page: "coverage", service: "checkout" }, "sample"],
    [{ live: "1" }, "live"],
    [{ incident: "inc-1" }, "live"],
    [{ suggestion: "sug-1" }, "live"],
    [{ suggestions: "coverage_gap" }, "live"],
  ] as [Record<string, string>, string][])(
    "the query %o opens the %s page in a dev and in a production build",
    async (query, page) => {
      for (const dev of [true, false]) {
        vi.stubEnv("DEV", dev);
        vi.stubEnv("MODE", dev ? "development" : "production");
        const w = await mountHome(query);
        expect(w.find('[data-test="deep-ask"]').attributes("data-page")).toBe(page);
        w.unmount();
      }
    },
  );

  it("a move inside the live page keeps the switch, and one inside the sample page adds none", () => {
    const to = at({ page: "coverage" }) as unknown as RouteLocationNormalized;
    const from = (query: Record<string, string>) => at(query) as unknown as RouteLocationNormalized;
    expect(keepLiveMode(to, from({ live: "1" }))).toEqual(at({ page: "coverage", live: "1" }));
    expect(keepLiveMode(to, from({ incident: "inc-1" }))).toEqual(
      at({ page: "coverage", live: "1" }),
    );
    expect(keepLiveMode(to, from({}))).toBeUndefined();
  });

  it.each(["standard", "nerd"] as const)(
    "Ask AI from a card in the %s view reaches the chat binding unchanged",
    async (mode) => {
      view.value = mode;
      const w = await mountHome(liveQuery({}));
      await w.find('[data-test="deep-ask"]').trigger("click");
      expect(w.emitted("sendToAiChat")).toEqual([[PAYLOAD]]);
      w.unmount();
    },
  );

  it.each(["standard", "nerd"] as const)(
    "the bulk review drawer is mounted in the %s view, so its production entry point works",
    async (mode) => {
      view.value = mode;
      const w = await mountHome(liveQuery({}));
      expect(w.findComponent({ name: "BulkReviewDrawer" }).exists()).toBe(true);
      w.unmount();
    },
  );
});
