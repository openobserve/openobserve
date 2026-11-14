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

import HistoryTab from "./HistoryTab.vue";
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
  useAssistantHistory: () => fake.current!.history,
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

async function mountTab(zo: Record<string, unknown>) {
  const h = settingsHarness(zo);
  const w = mount(HistoryTab, { global: { plugins: h.plugins } });
  await settle();
  return w;
}

beforeEach(() => {
  vi.mocked(assistant.capabilities).mockResolvedValue(null);
});

afterEach(() => vi.clearAllMocks());

describe("HistoryTab", () => {
  it("says chats live in each browser when persistence is off, without retention or public rows", async () => {
    fake.current = fakeAssistant("available", { persistence: false });
    const w = await mountTab({ ai_chat_persistence_enabled: false });
    expect(w.find('[data-test="settings-assistant-history-card"]').text()).toContain(
      "Saved in each member's browser only",
    );
    expect(w.text()).toContain("are capped at 100 per member per organization");
    expect(
      w.find('[data-test="settings-assistant-env-O2_AI_CHAT_PERSISTENCE_ENABLED-value"]').text(),
    ).toBe("false");
    expect(w.find('[data-test="settings-assistant-env-O2_AI_CHAT_RETENTION_DAYS"]').exists()).toBe(
      false,
    );
    expect(w.find('[data-test="settings-assistant-env-ZO_PUBLIC_AI_CHAT_ENABLED"]').exists()).toBe(
      false,
    );
  });

  it("states retention, public links and the logical delete when persistence is on", async () => {
    fake.current = fakeAssistant("available", { retentionDays: 30, publicMaxExpiryDays: 7 });
    const w = await mountTab({ ai_chat_persistence_enabled: true, public_ai_chat_enabled: true });
    expect(w.text()).toContain("Saved to the server");
    expect(
      w.find('[data-test="settings-assistant-env-O2_AI_CHAT_RETENTION_DAYS-value"]').text(),
    ).toBe("30 days");
    expect(
      w.find('[data-test="settings-assistant-env-ZO_PUBLIC_AI_CHAT_ENABLED-value"]').text(),
    ).toBe("on, up to 7 days");
    expect(w.find('[data-test="settings-assistant-history-delete-line"]').text()).not.toContain(
      "permanently",
    );
  });

  it("reads retention 0 as until deleted and an unreported retention as not reported", async () => {
    fake.current = fakeAssistant("available", { retentionDays: 0 });
    let w = await mountTab({ ai_chat_persistence_enabled: true, public_ai_chat_enabled: false });
    expect(
      w.find('[data-test="settings-assistant-env-O2_AI_CHAT_RETENTION_DAYS-value"]').text(),
    ).toBe("until deleted");
    expect(
      w.find('[data-test="settings-assistant-env-ZO_PUBLIC_AI_CHAT_ENABLED-value"]').text(),
    ).toBe("off");
    fake.current = fakeAssistant("available");
    w = await mountTab({ ai_chat_persistence_enabled: true });
    expect(
      w.find('[data-test="settings-assistant-env-O2_AI_CHAT_RETENTION_DAYS-value"]').text(),
    ).toBe("—");
  });

  it("renders the same for a member", async () => {
    fake.current = fakeAssistant("available", { isAdmin: false });
    const w = await mountTab({ ai_chat_persistence_enabled: false });
    expect(w.text()).toContain("Saved in each member's browser only");
  });

  it("offers to move this browser's chats to the server, reading them on the Settings page itself", async () => {
    fake.current = fakeAssistant("available", { persistence: true, historyImport: true });
    for (const id of [1, 2])
      fake.current.db.rows.set(id, {
        id,
        timestamp: new Date(id).toISOString(),
        title: `Chat ${id}`,
        messages: [{ role: "user", content: `question ${id}` }],
        sessionId: `0190ffff-c3d4-7e5f-8a9b-${String(id).padStart(12, "0")}`,
        userOrgKey: fake.current.store.state.userOrgKey,
      } as never);
    const w = await mountTab({ ai_chat_persistence_enabled: true });
    expect(fake.current.history.importView.value).toMatchObject({ state: "offer", count: 2 });
    expect(w.find('[data-test="assistant-local-import-banner"]').exists()).toBe(true);
  });

  it("never offers the move to a reader who cannot chat", async () => {
    fake.current = fakeAssistant("available", {
      persistence: true,
      historyImport: true,
      canChat: "no",
    });
    fake.current.db.rows.set(1, {
      id: 1,
      timestamp: new Date(1).toISOString(),
      title: "Chat 1",
      messages: [{ role: "user", content: "question 1" }],
      sessionId: "0190ffff-c3d4-7e5f-8a9b-000000000001",
      userOrgKey: fake.current.store.state.userOrgKey,
    } as never);
    const w = await mountTab({ ai_chat_persistence_enabled: true });
    expect(w.find('[data-test="assistant-local-import-banner"]').exists()).toBe(false);
  });
});
