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

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import onlineEvalsService, { type Provider } from "@/services/online-evals.service";
import OneClickEvalDialog from "./OneClickEvalDialog.vue";

const { push, executeQueryOnce, pricingTest } = vi.hoisted(() => ({
  push: vi.fn(() => Promise.resolve()),
  executeQueryOnce: vi.fn(),
  pricingTest: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push,
    currentRoute: { value: { path: "/ai/evaluations", query: { tab: "quality" } } },
    resolve: (to: { path: string; query: Record<string, string> }) => ({
      fullPath: `${to.path}?${new URLSearchParams(to.query)}`,
    }),
  }),
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({ executeQueryOnce }),
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: vi.fn().mockResolvedValue({ list: [{ name: "llm" }] }) }),
}));
vi.mock("@/services/online-evals-catalog.service", () => ({
  fetchOnlineEvalsCatalog: vi.fn().mockResolvedValue({ scorers: [], scoreConfigs: [] }),
}));
vi.mock("@/services/model_pricing", () => ({ default: { test: pricingTest } }));
vi.mock("@/services/online-evals.service", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { providers: { list: vi.fn(), testConfig: vi.fn() } },
  });
});

const DEBOUNCE_MS = 400;

describe("OneClickEvalDialog", () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(onlineEvalsService.providers.list).mockResolvedValue([]);
    executeQueryOnce.mockResolvedValue([{ cnt: 200 }, { cnt: 400 }]);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  async function mountDialog() {
    wrapper = mount(OneClickEvalDialog, {
      props: { open: true, agent: "support-bot" },
      global: { plugins: [store, i18n] },
    });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await flushPromises();
  }

  const estimate = () =>
    document.body.querySelector('[data-test="one-click-eval-estimate"]')?.textContent ?? "";

  it("estimates the agent's traces a day on the selected stream and states the budget", async () => {
    await mountDialog();

    const [sql] = executeQueryOnce.mock.calls[0];
    expect(sql).toContain('FROM "llm"');
    expect(sql).toContain("gen_ai_agent_name = 'support-bot'");
    // 300 traces a day × the 10% default sample.
    expect(estimate()).toContain("30");
    expect(estimate()).toContain("$5.00");
  });

  it("states the budget without traffic to estimate from", async () => {
    executeQueryOnce.mockResolvedValue([]);
    await mountDialog();

    expect(estimate()).toContain("$5.00");
  });

  describe("judge model pricing", () => {
    const unpricedBanner = () =>
      document.body.querySelector('[data-test="one-click-eval-unpriced"]');

    beforeEach(() => {
      // Only the fields the dialog reads.
      vi.mocked(onlineEvalsService.providers.list).mockResolvedValue([
        { id: "p1", name: "qa", defaultModel: "mock-judge", isDefault: true },
      ] as unknown as Provider[]);
    });

    it("does not promise the budget pause when the judge model has no price", async () => {
      pricingTest.mockResolvedValue({ data: { matched: null } });
      await mountDialog();

      expect(pricingTest).toHaveBeenCalledWith("default", { model_name: "mock-judge" });
      expect(unpricedBanner()).not.toBeNull();
      expect(estimate()).not.toContain("$5.00");
    });

    it("keeps the budget for a priced judge model, or when the lookup fails", async () => {
      pricingTest.mockResolvedValue({ data: { matched: { name: "mock" } } });
      await mountDialog();
      expect(unpricedBanner()).toBeNull();
      wrapper?.unmount();

      pricingTest.mockRejectedValue(new Error("403"));
      await mountDialog();
      expect(unpricedBanner()).toBeNull();
      expect(estimate()).toContain("$5.00");
    });
  });

  // After saving the provider the user comes back to the reopened dialog.
  it("sends Add provider to the LLM Providers page with a way back to the dialog", async () => {
    await mountDialog();

    (
      document.body.querySelector('[data-test="one-click-eval-add-provider"]') as HTMLElement
    ).click();

    expect(push).toHaveBeenCalledWith({
      name: "llmProviders",
      query: {
        org_identifier: "default",
        action: "add",
        return_to: "/ai/evaluations?tab=quality&one_click=1",
      },
    });
  });
});
