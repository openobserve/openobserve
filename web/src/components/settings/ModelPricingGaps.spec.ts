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
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import ModelPricingGaps from "./ModelPricingGaps.vue";

vi.mock("@/services/model_pricing");

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const routerPushMock = vi.fn();
const routerReplaceMock = vi.fn();
const currentRouteRef = { value: { query: {} as Record<string, any> } };
vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock,
    currentRoute: currentRouteRef,
  }),
}));

// The stream picker lists LLM trace streams.
const mockGetStreams = vi.fn();
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: mockGetStreams }),
}));

import modelPricingService from "@/services/model_pricing";

const unpricedResponse = {
  models: [
    {
      model: "acme-internal-llm",
      status: "unpriced",
      spans: 1870,
      tokens: 2_330_000,
      cost: 0,
      agents: ["research-agent"],
      agent_count: 1,
      matched: null,
    },
    {
      model: "gpt-5.4-mini",
      status: "approximate",
      spans: 1204,
      tokens: 9_100_000,
      cost: 41.22,
      agents: ["support-bot"],
      agent_count: 1,
      matched: {
        name: "GPT-5.4",
        match_pattern: "^gpt-5\\.4",
        source: "built_in",
        tiers: [{ name: "Default", condition: null, prices: { input: 2.5e-6, output: 1.5e-5 } }],
      },
    },
  ],
};

function mountPage(query: Record<string, any> = {}) {
  const store = createStore({ state: { selectedOrganization: { identifier: "test-org" } } });
  currentRouteRef.value.query = query;
  return mount(ModelPricingGaps, {
    global: { provide: { store }, mocks: { $store: store } },
  });
}

describe("ModelPricingGaps", () => {
  let w: any;

  beforeEach(() => {
    vi.mocked(modelPricingService.listUnpriced).mockResolvedValue({
      data: unpricedResponse,
    } as any);
    mockGetStreams.mockResolvedValue({
      list: [
        { name: "default", settings: { is_llm_stream: true } },
        { name: "llm", settings: {} },
        { name: "plain", settings: { is_llm_stream: false } },
      ],
    });
  });

  afterEach(() => {
    w?.unmount();
    vi.clearAllMocks();
  });

  it("opens the stream named by ?stream= and renders the last 24 h of unpriced models", async () => {
    w = mountPage({ stream: "llm" });
    await flushPromises();

    const [org, params] = vi.mocked(modelPricingService.listUnpriced).mock.calls.at(-1)!;
    expect(org).toBe("test-org");
    expect(params.stream_name).toBe("llm");
    expect(params.end_time - params.start_time).toBe(24 * 60 * 60 * 1_000_000);

    expect(w.findComponent({ name: "UnpricedModelsTable" }).props("streams")).toEqual([
      "default",
      "llm",
    ]);
    await vi.waitFor(() =>
      expect(w.findAll('[data-test="model-pricing-unpriced-row"]')).toHaveLength(2),
    );
  });

  it("reads the first LLM stream when the link names none", async () => {
    w = mountPage();
    await flushPromises();
    expect(vi.mocked(modelPricingService.listUnpriced).mock.calls.at(-1)![1].stream_name).toBe(
      "default",
    );
  });

  it("writes a picked stream to the route query, so a reload reopens it", async () => {
    w = mountPage({ stream: "default", org_identifier: "test-org" });
    await flushPromises();

    w.findComponent({ name: "UnpricedModelsTable" }).vm.$emit("update:stream", "llm");
    await flushPromises();

    expect(routerReplaceMock).toHaveBeenLastCalledWith({
      query: { stream: "llm", org_identifier: "test-org" },
    });
    expect(vi.mocked(modelPricingService.listUnpriced).mock.calls.at(-1)![1].stream_name).toBe(
      "llm",
    );
  });

  it("shows the load error when the read fails, and Retry reads again", async () => {
    vi.mocked(modelPricingService.listUnpriced).mockRejectedValue({ response: { status: 400 } });
    w = mountPage();
    await vi.waitFor(() =>
      expect(w.find('[data-test="model-pricing-unpriced-error"]').exists()).toBe(true),
    );
    expect(w.find('[data-test="model-pricing-unpriced-empty"]').exists()).toBe(false);
    const calls = vi.mocked(modelPricingService.listUnpriced).mock.calls.length;

    // A later timestamp gives the retried read a new window, so it never reuses the failed one.
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
    await w.find('[data-test="o2-empty-state-action-retry"]').trigger("click");
    await flushPromises();
    now.mockRestore();

    expect(vi.mocked(modelPricingService.listUnpriced).mock.calls.length).toBeGreaterThan(calls);
  });

  it("Back returns to the price list", async () => {
    w = mountPage();
    await flushPromises();
    await w.find('[data-test="model-pricing-gaps-back-btn"]').trigger("click");
    expect(routerPushMock).toHaveBeenCalledWith({
      name: "modelPricing",
      query: { org_identifier: "test-org" },
    });
  });
});
