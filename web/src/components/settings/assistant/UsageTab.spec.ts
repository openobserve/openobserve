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
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeAssistant } from "@/components/ai-assistant/__tests__/fakeAssistant";
import assistant, { parseAiUsage } from "@/services/assistant";

import UsageTab from "./UsageTab.vue";
import { settingsHarness } from "./assistantSettings.test-helpers";

const { fake, toast } = vi.hoisted(() => ({
  fake: {
    current: null as ReturnType<
      typeof import("@/components/ai-assistant/__tests__/fakeAssistant").fakeAssistant
    > | null,
  },
  toast: vi.fn(),
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantCapability: () => fake.current!.handle,
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));
vi.mock("@/services/assistant_settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/assistant_settings")>();
  return { ...actual, default: { get: vi.fn(), update: vi.fn() } };
});
vi.mock("@/services/assistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/assistant")>();
  return {
    ...actual,
    default: { capabilities: vi.fn(), testCapabilities: vi.fn(), usage: vi.fn(async () => null) },
  };
});
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: vi.fn(),
}));

async function settle() {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

async function mountTab(zo: Record<string, unknown> = {}, org = "acme") {
  const h = settingsHarness(zo);
  h.store.state.selectedOrganization.identifier = org;
  const w = mount(UsageTab, { global: { plugins: h.plugins } });
  await settle();
  return { w, router: h.router };
}

afterEach(() => vi.clearAllMocks());

describe("UsageTab", () => {
  it("states that a self-hosted deployment is not metered and omits the strip", async () => {
    fake.current = fakeAssistant("available", { edition: "ee" });
    const { w } = await mountTab();
    expect(w.find('[data-test="settings-assistant-usage-not-metered"]').text()).toBe(
      "Usage metering is available on OpenObserve Cloud. This deployment is not metered.",
    );
    expect(w.find('[data-test="settings-assistant-usage-stats"]').exists()).toBe(false);
  });

  it("on Cloud shows the period strip with dashes, never zeros, and the paid usage link", async () => {
    fake.current = fakeAssistant("available", { edition: "cloud" });
    const { w, router } = await mountTab();
    const strip = w.find('[data-test="settings-assistant-usage-stats"]');
    expect(strip.text()).toContain("—");
    expect(strip.text()).not.toMatch(/\b0\b/);
    expect(w.find('[data-test="settings-assistant-usage-allowance"]').exists()).toBe(false);
    await w.find('[data-test="settings-assistant-usage-manage-paid"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("plans");
  });

  it("on Cloud renders the credit meter from the usage read, and Retry when it fails", async () => {
    vi.mocked(assistant.usage).mockResolvedValueOnce(
      parseAiUsage({ credits_used: 300, credits_limit: 1000, mode: "free" }),
    );
    fake.current = fakeAssistant("available", { edition: "cloud" });
    const { w } = await mountTab();
    const meter = w.get(
      '[data-test="settings-assistant-usage-card"] [data-test="assistant-credit-meter"]',
    );
    expect(meter.attributes("data-state")).toBe("ready");
    expect(meter.get('[data-test="assistant-credit-meter-text"]').text()).toMatch(
      /^300 of 1,000 included credits · /,
    );
    expect(meter.find('[data-test="assistant-credit-meter-bar"]').exists()).toBe(true);
    vi.mocked(assistant.usage).mockRejectedValueOnce(new Error("500"));
    fake.current = fakeAssistant("available", { edition: "cloud" });
    const failed = await mountTab({}, "acme-2");
    expect(failed.w.find('[data-test="assistant-credit-meter-retry"]').exists()).toBe(true);
  });

  it("gives members no billing button they cannot open", async () => {
    fake.current = fakeAssistant("available", { edition: "cloud", isAdmin: false });
    const { w } = await mountTab();
    expect(w.find('[data-test="settings-assistant-usage-manage-paid"]').exists()).toBe(false);
    expect(w.find('[data-test="settings-assistant-usage-stats"]').exists()).toBe(true);
  });

  it("offers the credit allowance to the meta org", async () => {
    fake.current = fakeAssistant("available", { edition: "cloud" });
    const { w } = await mountTab({}, "_meta");
    expect(w.find('[data-test="settings-assistant-usage-allowance"]').exists()).toBe(true);
  });

  it("tells admins what members read when credits are used up or consent is needed", async () => {
    fake.current = fakeAssistant("available", { edition: "cloud", creditMode: "exhausted" });
    let { w } = await mountTab();
    expect(w.find('[data-test="settings-assistant-usage-mode-line"]').text()).toBe(
      "Members see 'AI credits are used up for Acme.'",
    );
    fake.current = fakeAssistant("available", { edition: "cloud", creditMode: "consent_required" });
    ({ w } = await mountTab());
    expect(w.find('[data-test="settings-assistant-usage-mode-line"]').text()).toContain(
      "Paid usage hasn't been enabled.",
    );
  });

  it("lists every cap as not reported with the cap consequence", async () => {
    fake.current = fakeAssistant("available");
    const { w } = await mountTab();
    const caps = w.find('[data-test="settings-assistant-caps-card"]');
    for (const env of [
      "O2_AI_CHAT_MAX_ACTIVE_TURNS_PER_USER",
      "O2_AI_CHAT_MAX_ACTIVE_TURNS_PER_ORG",
      "O2_AI_CHAT_MAX_ACTIVE_TURNS_PER_NODE",
      "O2_AI_CHAT_MAX_TURN_SECS",
    ]) {
      expect(caps.find(`[data-test="settings-assistant-env-${env}-value"]`).text()).toBe("—");
    }
    expect(caps.text()).toContain("nothing is sent or charged");
  });
});
