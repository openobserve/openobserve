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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import type { AxiosResponse } from "axios";
import type { UnpricedModel } from "@/services/model_pricing";
import UnpricedModelsTable from "./UnpricedModelsTable.vue";

vi.mock("@/services/model_pricing", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { create: vi.fn() } });
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const routerPushMock = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPushMock, currentRoute: { value: { query: {} } } }),
}));

import modelPricingService from "@/services/model_pricing";

const ConfirmDialogStub = {
  name: "ConfirmDialog",
  props: ["modelValue", "title", "message", "okLabel"],
  emits: ["update:ok", "update:cancel", "update:modelValue"],
  template: `
    <div data-test="confirm-dialog-stub" :data-open="String(!!modelValue)">
      <button data-test="confirm-dialog-ok" @click="$emit('update:ok')">ok</button>
    </div>
  `,
};

/** The two rows of a GET /llm/models/unpriced response, as the design draws them. */
const unpricedResponse: { models: UnpricedModel[] } = {
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

function mountTab(
  models: UnpricedModel[] = unpricedResponse.models,
  overrides: Record<string, unknown> = {},
) {
  const store = createStore({ state: { selectedOrganization: { identifier: "test-org" } } });
  return mount(UnpricedModelsTable, {
    props: {
      models,
      loading: false,
      fetching: false,
      error: false,
      loaded: true,
      lastRunAt: 0,
      streams: ["default"],
      streamsLoaded: true,
      stream: "default",
      ...overrides,
    },
    global: {
      provide: { store },
      mocks: { $store: store },
      stubs: { ConfirmDialog: ConfirmDialogStub },
    },
  });
}

// OTable keeps its loading skeleton up for a minimum real-time window.
async function waitForRow(w: VueWrapper, model: string) {
  return vi.waitFor(() => {
    const row = w.findAll('[data-test^="o2-table-row-"]').find((r) => r.text().includes(model));
    expect(row).toBeTruthy();
    return row!;
  });
}

describe("UnpricedModelsTable", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(modelPricingService.create).mockResolvedValue({ data: {} } as AxiosResponse);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("renders one row per model, with Mute for unpriced and Keep for approximate", async () => {
    wrapper = mountTab();
    const unpriced = await waitForRow(wrapper, "acme-internal-llm");
    const approximate = await waitForRow(wrapper, "gpt-5.4-mini");

    expect(wrapper.findAll('[data-test="model-pricing-unpriced-row"]')).toHaveLength(2);
    expect(unpriced.text()).toContain("research-agent");
    expect(unpriced.find('[data-test="model-pricing-unpriced-mute-btn"]').exists()).toBe(true);
    expect(unpriced.find('[data-test="model-pricing-unpriced-keep-btn"]').exists()).toBe(false);

    expect(approximate.text()).toContain("GPT-5.4");
    expect(approximate.text()).toContain("$2.50");
    expect(approximate.text()).toContain("$15.00");
    expect(approximate.find('[data-test="model-pricing-unpriced-keep-btn"]').exists()).toBe(true);
    expect(approximate.find('[data-test="model-pricing-unpriced-mute-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="model-pricing-unpriced-banner"]').exists()).toBe(true);
  });

  it("shows how many agents the server left out of a capped list", async () => {
    const [first, second] = unpricedResponse.models;
    wrapper = mountTab([
      { ...first, agents: ["research-agent", "triage"], agent_count: 7 },
      second,
    ]);
    const row = await waitForRow(wrapper, "acme-internal-llm");
    expect(row.text()).toContain("research-agent, triage, +5 more");
  });

  it("keeps a historical gap visible after an exact price covers new spans", async () => {
    const row = { ...unpricedResponse.models[1], priced_now: true };
    wrapper = mountTab([row]);
    const shown = await waitForRow(wrapper, row.model!);
    expect(shown.text()).toContain("Priced for new spans");
    expect(shown.find('[data-test="model-pricing-unpriced-priced-since"]').text()).toBe(
      "No action needed",
    );
    expect(shown.find('[data-test="model-pricing-unpriced-create-btn"]').exists()).toBe(false);
    expect(shown.find('[data-test="model-pricing-unpriced-keep-btn"]').exists()).toBe(false);
    expect(shown.find('[data-test="model-pricing-unpriced-mute-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="model-pricing-unpriced-empty"]').exists()).toBe(false);
  });

  it("shows the all-priced empty state and no banner when no model is listed", async () => {
    wrapper = mountTab([]);
    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="model-pricing-unpriced-empty"]').exists()).toBe(true),
    );
    expect(wrapper.find('[data-test="model-pricing-unpriced-banner"]').exists()).toBe(false);
  });

  it("names every marked model in the banner when the server listed only the top ones", async () => {
    wrapper = mountTab(unpricedResponse.models, { truncatedOf: 140 });
    await waitForRow(wrapper, "acme-internal-llm");
    const banner = wrapper.find('[data-test="model-pricing-unpriced-banner"]').text();
    expect(banner).toContain("140 models");
    expect(banner).toContain("top 2 by tokens");
  });

  it("shows the load error, not the all-priced state, and Retry asks for a new read", async () => {
    wrapper = mountTab([], { error: true, loaded: false });
    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="model-pricing-unpriced-error"]').exists()).toBe(true),
    );
    expect(wrapper.find('[data-test="model-pricing-unpriced-empty"]').exists()).toBe(false);

    await wrapper.find('[data-test="o2-empty-state-action-retry"]').trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });

  it("holds the skeleton, not the all-priced state, while the stream list loads", async () => {
    wrapper = mountTab([], { streams: [], streamsLoaded: false, stream: "", loaded: false });
    await flushPromises();
    expect(wrapper.find('[data-test="o2-table-skeleton-body"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="model-pricing-unpriced-empty"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="model-pricing-unpriced-no-streams"]').exists()).toBe(false);
  });

  it("holds the skeleton, not the all-priced state, until the first read succeeds", async () => {
    wrapper = mountTab([], { loading: true, loaded: false });
    await flushPromises();
    expect(wrapper.find('[data-test="o2-table-skeleton-body"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="model-pricing-unpriced-empty"]').exists()).toBe(false);
  });

  it("shows a missing price side as not priced and Keep saves only the priced side", async () => {
    const oneSided: UnpricedModel = {
      ...unpricedResponse.models[1],
      matched: {
        ...unpricedResponse.models[1].matched!,
        tiers: [{ name: "Default", condition: null, prices: { input: 2.5e-6 } }],
      },
    };
    wrapper = mountTab([oneSided]);
    const row = await waitForRow(wrapper, "gpt-5.4-mini");
    expect(row.text()).toContain("$2.50");
    expect(row.text()).toContain("not priced");
    expect(row.text()).not.toContain("$0.00");

    await row.find('[data-test="model-pricing-unpriced-keep-btn"]').trigger("click");
    await flushPromises();
    const saved = vi.mocked(modelPricingService.create).mock.calls[0][1];
    expect(saved.tiers[0].prices).toEqual({ input: 2.5e-6 });
    expect(saved.tiers[0].prices).not.toHaveProperty("output");
  });

  it("Create price opens the New model editor with the exact pattern filled in", async () => {
    wrapper = mountTab();
    const row = await waitForRow(wrapper, "gpt-5.4-mini");
    await row.find('[data-test="model-pricing-unpriced-create-btn"]').trigger("click");

    expect(routerPushMock).toHaveBeenCalledWith({
      name: "modelPricingEditor",
      query: {
        org_identifier: "test-org",
        name: "gpt-5.4-mini",
        match_pattern: "^gpt-5\\.4-mini$",
        from: "gaps",
        stream: "default",
      },
    });
  });

  it("lists spans without a model name as one row that links to the instrumentation guide", async () => {
    const noModel: UnpricedModel = {
      model: null,
      status: "unpriced",
      spans: 4,
      tokens: 1200,
      cost: 0,
      agents: [],
      agent_count: 0,
      matched: null,
    };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    wrapper = mountTab([noModel, ...unpricedResponse.models]);
    const row = await waitForRow(wrapper, "(no model name)");

    expect(wrapper.findAll('[data-test="model-pricing-unpriced-row"]')).toHaveLength(3);
    // Nothing to price: no Create price or Mute, a pointer to the fix instead.
    expect(row.find('[data-test="model-pricing-unpriced-create-btn"]').exists()).toBe(false);
    expect(row.find('[data-test="model-pricing-unpriced-mute-btn"]').exists()).toBe(false);
    expect(row.find('[data-test="model-pricing-unpriced-no-model"]').exists()).toBe(true);
    await row.find('[data-test="model-pricing-unpriced-docs-btn"]').trigger("click");
    expect(open).toHaveBeenCalledWith(
      "https://openobserve.ai/docs/integration/ai/",
      "_blank",
      "noopener,noreferrer",
    );
    expect(routerPushMock).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("Keep saves an exact org price that copies the matched tiers", async () => {
    wrapper = mountTab();
    const row = await waitForRow(wrapper, "gpt-5.4-mini");
    await row.find('[data-test="model-pricing-unpriced-keep-btn"]').trigger("click");
    await flushPromises();

    expect(modelPricingService.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(modelPricingService.create).mock.calls[0]).toEqual([
      "test-org",
      expect.objectContaining({
        name: "gpt-5.4-mini",
        match_pattern: "^gpt-5\\.4-mini$",
        tiers: unpricedResponse.models[1].matched!.tiers,
      }),
    ]);
  });

  it("Mute saves a zero price only after the confirm", async () => {
    wrapper = mountTab();
    const row = await waitForRow(wrapper, "acme-internal-llm");
    await row.find('[data-test="model-pricing-unpriced-mute-btn"]').trigger("click");
    await flushPromises();
    expect(modelPricingService.create).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="confirm-dialog-stub"]').attributes("data-open")).toBe("true");

    await wrapper.find('[data-test="confirm-dialog-ok"]').trigger("click");
    await flushPromises();

    expect(vi.mocked(modelPricingService.create).mock.calls[0]).toEqual([
      "test-org",
      expect.objectContaining({
        name: "acme-internal-llm (muted)",
        match_pattern: "^acme-internal-llm$",
        tiers: [{ name: "Default", condition: null, prices: { input: 0, output: 0 } }],
      }),
    ]);
  });
});
