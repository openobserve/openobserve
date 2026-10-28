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
import UnpricedModelsTab from "./UnpricedModelsTab.vue";

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
      matched: null,
    },
    {
      model: "gpt-5.4-mini",
      status: "approximate",
      spans: 1204,
      tokens: 9_100_000,
      cost: 41.22,
      agents: ["support-bot"],
      matched: {
        name: "GPT-5.4",
        match_pattern: "^gpt-5\\.4",
        source: "built_in",
        tiers: [{ name: "Default", condition: null, prices: { input: 2.5e-6, output: 1.5e-5 } }],
      },
    },
  ],
};

function mountTab(models: UnpricedModel[] = unpricedResponse.models) {
  const store = createStore({ state: { selectedOrganization: { identifier: "test-org" } } });
  return mount(UnpricedModelsTab, {
    props: {
      models,
      loading: false,
      fetching: false,
      lastRunAt: 0,
      streams: ["default"],
      streamsLoaded: true,
      stream: "default",
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

describe("UnpricedModelsTab", () => {
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

  it("shows the all-priced empty state and no banner when no model is listed", async () => {
    wrapper = mountTab([]);
    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="model-pricing-unpriced-empty"]').exists()).toBe(true),
    );
    expect(wrapper.find('[data-test="model-pricing-unpriced-banner"]').exists()).toBe(false);
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
