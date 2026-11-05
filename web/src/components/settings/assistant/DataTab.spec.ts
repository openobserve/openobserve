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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeAssistant } from "@/components/ai-assistant/__tests__/fakeAssistant";
import assistant from "@/services/assistant";
import assistantSettings from "@/services/assistant_settings";

import DataTab from "./DataTab.vue";
import { ORG_SETTINGS, settingsHarness } from "./assistantSettings.test-helpers";

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
  return { ...actual, default: { capabilities: vi.fn(), testCapabilities: vi.fn() } };
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

async function mountTab() {
  const h = settingsHarness();
  const w = mount(DataTab, { global: { plugins: h.plugins }, attachTo: document.body });
  await settle();
  return w;
}

let wrapper: Awaited<ReturnType<typeof mountTab>> | null = null;

beforeEach(() => {
  fake.current = fakeAssistant("available");
  vi.mocked(assistantSettings.get).mockResolvedValue({
    ...ORG_SETTINGS,
    data_sharing_level: "aggregates",
  });
  vi.mocked(assistantSettings.update).mockImplementation(async (_o, body) => ({
    ...ORG_SETTINGS,
    ...body,
  }));
  vi.mocked(assistant.capabilities).mockResolvedValue({
    policy_enforced: true,
    model_provider: "OpenAI",
    redaction_applied: true,
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("DataTab", () => {
  it("selects the stored level with its consequence line", async () => {
    wrapper = await mountTab();
    expect(
      wrapper
        .find('[data-test="settings-assistant-data-level-aggregates"]')
        .attributes("data-state"),
    ).toBe("on");
    expect(wrapper.text()).toContain("Counts, percentiles and histograms; no individual rows.");
    expect(wrapper.find('[data-test="settings-assistant-data-notice"]').exists()).toBe(false);
  });

  it("saves the level with the other stored settings unchanged", async () => {
    wrapper = await mountTab();
    await wrapper.find('[data-test="settings-assistant-data-level-schema"]').trigger("click");
    await wrapper.find('[data-test="settings-assistant-data-form"]').trigger("submit");
    await settle();
    expect(assistantSettings.update).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        enabled: true,
        permission_tier: "act_with_approval",
        org_sharing: true,
        public_sharing: true,
        data_sharing_level: "schema",
      }),
    );
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("saves over a fresh read, so a change made elsewhere since load survives", async () => {
    wrapper = await mountTab();
    vi.mocked(assistantSettings.get).mockResolvedValue({ ...ORG_SETTINGS, enabled: false });
    await wrapper.find('[data-test="settings-assistant-data-level-schema"]').trigger("click");
    await wrapper.find('[data-test="settings-assistant-data-form"]').trigger("submit");
    await settle();
    expect(assistantSettings.update).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ enabled: false, data_sharing_level: "schema" }),
    );
  });

  it("keeps focus on Save when the save fails", async () => {
    vi.mocked(assistantSettings.update).mockRejectedValue(new Error("boom"));
    wrapper = await mountTab();
    await wrapper.find('[data-test="settings-assistant-data-level-schema"]').trigger("click");
    await wrapper.find('[data-test="settings-assistant-data-form"]').trigger("submit");
    await settle();
    const save = wrapper.find('[data-test="settings-assistant-data-save"]');
    expect(document.activeElement).toBe(save.element);
    expect(save.attributes("disabled")).toBeUndefined();
  });

  it("is read-only at raw rows when the agent cannot enforce a level", async () => {
    vi.mocked(assistant.capabilities).mockResolvedValue({ policy_enforced: false });
    wrapper = await mountTab();
    expect(wrapper.find('[data-test="settings-assistant-data-notice"]').text()).toBe(
      "Data-sharing levels need a newer server and agent version.",
    );
    expect(
      wrapper.find('[data-test="settings-assistant-data-level-raw"]').attributes("data-state"),
    ).toBe("on");
    expect(wrapper.find('[data-test="settings-assistant-data-save"]').exists()).toBe(false);
  });

  it("is read-only without org settings", async () => {
    vi.mocked(assistantSettings.get).mockResolvedValue(null);
    wrapper = await mountTab();
    expect(wrapper.find('[data-test="settings-assistant-data-notice"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="settings-assistant-data-save"]').exists()).toBe(false);
  });

  it("names the provider and the redaction rule in About data sharing", async () => {
    wrapper = await mountTab();
    await wrapper.find('[data-test="settings-assistant-data-about"]').trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("Answers are generated by OpenAI.");
    expect(document.body.textContent).toContain(
      "redaction rules in Sensitive data redaction apply first",
    );
  });

  it("shows a load error with Retry", async () => {
    vi.mocked(assistantSettings.get).mockRejectedValue(
      Object.assign(new Error("x"), { response: { status: 500 } }),
    );
    wrapper = await mountTab();
    expect(wrapper.find('[data-test="settings-assistant-data-error"]').exists()).toBe(true);
  });
});
