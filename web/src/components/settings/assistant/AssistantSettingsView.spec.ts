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
import { defineComponent, h } from "vue";
import { RouterView } from "vue-router";

import { fakeAssistant } from "@/components/ai-assistant/__tests__/fakeAssistant";
import assistant from "@/services/assistant";
import assistantSettings from "@/services/assistant_settings";

import AssistantSettingsView from "./AssistantSettingsView.vue";
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

async function mountView(path: string, zo: Record<string, unknown> = {}) {
  const harness = settingsHarness(zo);
  harness.router.removeRoute("assistantSettings");
  harness.router.addRoute({
    path: "/settings/assistant/:tab?",
    name: "assistantSettings",
    component: AssistantSettingsView,
    props: true,
  });
  await harness.router.push(path);
  const Host = defineComponent({ render: () => h(RouterView) });
  const w = mount(Host, { global: { plugins: harness.plugins }, attachTo: document.body });
  await settle();
  return { w, router: harness.router };
}

let wrapper: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  fake.current = fakeAssistant("available");
  vi.mocked(assistant.capabilities).mockResolvedValue({
    health: { status: "ok" },
    policy_enforced: true,
  });
  vi.mocked(assistantSettings.get).mockResolvedValue({ ...ORG_SETTINGS });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("AssistantSettingsView", () => {
  it("titles the page with the product name and renders the tab strip", async () => {
    const { w } = await mountView("/settings/assistant/status");
    wrapper = w;
    expect(w.find('[data-test="settings-assistant-page-title"]').text()).toBe("O2 Assistant");
    for (const id of [
      "status",
      "access",
      "data",
      "history",
      "usage",
      "toolsets",
      "permissions",
      "activity",
    ]) {
      expect(w.find(`[data-test="settings-assistant-tab-${id}"]`).exists()).toBe(true);
    }
  });

  it.each(["access", "data", "history", "usage"])("deep-links the %s tab", async (tab) => {
    const { w } = await mountView(`/settings/assistant/${tab}`);
    wrapper = w;
    expect(w.find(`[data-test="settings-assistant-panel-${tab}"]`).exists()).toBe(true);
    expect(w.find(`[data-test="settings-assistant-${tab}-tab"]`).exists()).toBe(true);
  });

  it("lands an unknown or missing tab on Status, keeping the query", async () => {
    const { w, router } = await mountView("/settings/assistant/nope?org_identifier=acme");
    wrapper = w;
    expect(router.currentRoute.value.params.tab).toBe("status");
    expect(router.currentRoute.value.query.org_identifier).toBe("acme");
  });

  it("shows members one admin-only helper with Ask an admin on tabs that hold settings", async () => {
    fake.current = fakeAssistant("available", { isAdmin: false });
    let { w } = await mountView("/settings/assistant/access");
    wrapper = w;
    expect(w.findAll('[data-test="settings-assistant-admin-only"]')).toHaveLength(1);
    expect(w.find('[data-test="settings-assistant-ask-admin"]').exists()).toBe(true);
    w.unmount();
    ({ w } = await mountView("/settings/assistant/history"));
    wrapper = w;
    expect(w.find('[data-test="settings-assistant-admin-only"]').exists()).toBe(false);
  });

  it("shows admins no helper", async () => {
    const { w } = await mountView("/settings/assistant/access");
    wrapper = w;
    expect(w.find('[data-test="settings-assistant-admin-only"]').exists()).toBe(false);
  });

  it("refresh forces the active tab's reads past their stale time", async () => {
    const { w } = await mountView("/settings/assistant/access");
    wrapper = w;
    expect(assistantSettings.get).toHaveBeenCalledTimes(1);
    await w.find('[data-test="settings-assistant-refresh"]').trigger("click");
    await settle();
    expect(assistantSettings.get).toHaveBeenCalledTimes(2);
  });

  it("says the settings have no effect yet on a deployment without an agent, except on Status", async () => {
    let { w } = await mountView("/settings/assistant/access", { ai_enabled: false });
    wrapper = w;
    expect(w.find('[data-test="settings-assistant-off-in-deployment"]').exists()).toBe(true);
    w.unmount();
    ({ w } = await mountView("/settings/assistant/status", { ai_enabled: false }));
    wrapper = w;
    expect(w.find('[data-test="settings-assistant-off-in-deployment"]').exists()).toBe(false);
  });
});
