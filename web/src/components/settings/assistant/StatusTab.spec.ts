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

import { ASSISTANT_V2_STORAGE_KEY, resetAssistantV2ForTests } from "@/composables/assistant/flags";

import StatusTab from "./StatusTab.vue";
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

async function mountTab(zo: Record<string, unknown> = {}) {
  const h = settingsHarness(zo);
  await h.router.push("/settings/assistant/status");
  const w = mount(StatusTab, { global: { plugins: h.plugins }, attachTo: document.body });
  await settle();
  return { w, router: h.router };
}

let wrapper: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  fake.current = fakeAssistant("available");
  vi.mocked(assistant.capabilities).mockResolvedValue({
    health: { status: "ok", checked_at: Date.now() },
  });
  vi.mocked(assistantSettings.get).mockResolvedValue({ ...ORG_SETTINGS });
  localStorage.removeItem(ASSISTANT_V2_STORAGE_KEY);
  resetAssistantV2ForTests();
});

afterEach(() => {
  delete window.__O2_ASSISTANT_V2__;
  resetAssistantV2ForTests();
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("StatusTab", () => {
  it("runs Test once per press, without opening a chat, and refetches capabilities", async () => {
    vi.mocked(assistant.testCapabilities).mockResolvedValue({ ok: true, duration_ms: 1200 });
    const { w } = await mountTab();
    wrapper = w;
    expect(assistant.capabilities).toHaveBeenCalledTimes(1);
    await w.find('[data-test="settings-assistant-test-btn"]').trigger("click");
    await settle();
    expect(assistant.testCapabilities).toHaveBeenCalledWith("acme");
    expect(w.find('[data-test="settings-assistant-test-announce"]').text()).toBe(
      "Test passed in 1.2 s",
    );
    expect(assistant.capabilities).toHaveBeenCalledTimes(2);
  });

  it("reports a failing Test with the server's cause", async () => {
    vi.mocked(assistant.testCapabilities).mockResolvedValue({
      ok: false,
      duration_ms: 30,
      error: "connection refused",
    });
    const { w } = await mountTab();
    wrapper = w;
    await w.find('[data-test="settings-assistant-test-btn"]').trigger("click");
    await settle();
    expect(w.find('[data-test="settings-assistant-test-announce"]').text()).toBe(
      "Test failed: connection refused",
    );
  });

  it("words a thrown Test in the product's error vocabulary and refetches the health", async () => {
    vi.mocked(assistant.testCapabilities).mockRejectedValue(
      Object.assign(new Error("Request failed with status code 502"), {
        isAxiosError: true,
        response: { status: 502, data: {} },
      }),
    );
    const { w } = await mountTab();
    wrapper = w;
    await w.find('[data-test="settings-assistant-test-btn"]').trigger("click");
    await settle();
    const text = w.find('[data-test="settings-assistant-test-announce"]').text();
    expect(text).toBe("Test failed: The assistant service didn't respond.");
    expect(assistant.capabilities).toHaveBeenCalledTimes(2);
  });

  it("keeps focus on Test while it runs", async () => {
    vi.mocked(assistant.testCapabilities).mockReturnValue(new Promise(() => {}));
    const { w } = await mountTab();
    wrapper = w;
    const btn = w.find('[data-test="settings-assistant-test-btn"]');
    (btn.element as HTMLButtonElement).focus();
    await btn.trigger("click");
    await settle();
    expect(document.activeElement).toBe(btn.element);
    expect(btn.attributes("aria-disabled")).toBe("true");
  });

  it("reads Configured when the probe is absent", async () => {
    vi.mocked(assistant.capabilities).mockResolvedValue(null);
    const { w } = await mountTab();
    wrapper = w;
    expect(w.find('[data-test="settings-assistant-status-chip"]').text()).toBe("Configured");
  });

  it("reads Off for this organization from org settings and opens Access", async () => {
    vi.mocked(assistantSettings.get).mockResolvedValue({ ...ORG_SETTINGS, enabled: false });
    const { w, router } = await mountTab();
    wrapper = w;
    expect(w.find('[data-test="settings-assistant-status-chip"]').text()).toBe(
      "Off for this organization",
    );
    await w.find('[data-test="settings-assistant-open-access"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.params.tab).toBe("access");
  });

  it("does not probe a deployment without an agent", async () => {
    const { w } = await mountTab({ ai_enabled: false });
    wrapper = w;
    expect(assistant.capabilities).not.toHaveBeenCalled();
    expect(w.find('[data-test="settings-assistant-setup-card"]').exists()).toBe(true);
  });

  it("binds the admin-only preview switch to this browser's opt-in", async () => {
    localStorage.setItem(ASSISTANT_V2_STORAGE_KEY, "1");
    const { w } = await mountTab();
    wrapper = w;
    const sw = w.find('[data-test="settings-assistant-v2-optin-switch"]').find('[role="switch"]');
    expect(sw.attributes("aria-checked")).toBe("true");
    await sw.trigger("click");
    expect(localStorage.getItem(ASSISTANT_V2_STORAGE_KEY)).toBeNull();
    await sw.trigger("click");
    expect(localStorage.getItem(ASSISTANT_V2_STORAGE_KEY)).toBe("1");
  });

  it("shows the preview on and locked when the deployment turned it on", async () => {
    window.__O2_ASSISTANT_V2__ = true;
    const { w } = await mountTab();
    wrapper = w;
    const sw = w.find('[data-test="settings-assistant-v2-optin-switch"]').find('[role="switch"]');
    expect(sw.attributes("aria-checked")).toBe("true");
    expect(sw.attributes("disabled")).toBeDefined();
    expect(w.find('[data-test="settings-assistant-v2-optin"]').text()).toContain(
      "Turned on for this deployment",
    );
  });

  it("hides the preview switch from members", async () => {
    fake.current = fakeAssistant("available", { isAdmin: false });
    const { w } = await mountTab();
    wrapper = w;
    expect(w.find('[data-test="settings-assistant-v2-optin"]').exists()).toBe(false);
  });
});
