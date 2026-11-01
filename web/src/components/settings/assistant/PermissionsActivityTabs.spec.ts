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
import assistantSettings from "@/services/assistant_settings";

import ActivityTab from "./ActivityTab.vue";
import PermissionsTab from "./PermissionsTab.vue";
import { settingsHarness } from "./assistantSettings.test-helpers";

const { fake, toast, confirm } = vi.hoisted(() => ({
  fake: {
    current: null as ReturnType<
      typeof import("@/components/ai-assistant/__tests__/fakeAssistant").fakeAssistant
    > | null,
  },
  toast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantCapability: () => fake.current!.handle,
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));
vi.mock("@/composables/useConfirmDialog", () => ({ useConfirmDialog: () => ({ confirm }) }));
vi.mock("@/services/assistant_settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/assistant_settings")>();
  return {
    ...actual,
    default: { grants: vi.fn(), revokeGrant: vi.fn(), activity: vi.fn(), undoActivity: vi.fn() },
  };
});

const GRANT = {
  id: "g1",
  tool: "alerts",
  operation: "update",
  scope: "always" as const,
  granted_by: "ada@example.com",
  granted_at: 1_767_225_600_000_000,
};

const ENTRY = {
  id: "a1",
  at: 1_767_225_600_000_000,
  action: "Deleted alert",
  on_behalf_of: "ada@example.com",
  target: { name: "checkout-latency-old", deleted: true },
  approval: { kind: "approved" as const, by: "bob@example.com" },
  result: { state: "done" as const },
  undo: { available: true },
  chat_id: "c1",
};

async function settle() {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

async function mountTab(component: unknown, rows = false) {
  const h = settingsHarness();
  const w = mount(component as never, { global: { plugins: h.plugins }, attachTo: document.body });
  await settle();
  if (rows)
    await vi.waitFor(() => expect(w.find('[data-test="o2-table-row-0"]').exists()).toBe(true));
  return w;
}

let wrapper: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  fake.current = fakeAssistant("available");
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("PermissionsTab", () => {
  it("says organization-wide approvals need a newer server", async () => {
    vi.mocked(assistantSettings.grants).mockResolvedValue(null);
    const w = (wrapper = await mountTab(PermissionsTab));
    expect(w.find('[data-test="settings-assistant-grants-unsupported"]').text()).toBe(
      "Organization-wide approvals need a newer server version.",
    );
    expect(w.find('[data-test="settings-assistant-grants-table"]').exists()).toBe(false);
  });

  it("shows a member their browser's approvals when the server keeps none", async () => {
    fake.current = fakeAssistant("available", { isAdmin: false });
    vi.mocked(assistantSettings.grants).mockResolvedValue(null);
    const w = (wrapper = await mountTab(PermissionsTab));
    expect(w.find("h2").text()).toBe("Your approvals in this browser");
    expect(w.find('[data-test="settings-assistant-grants-browser"]').exists()).toBe(true);
    expect(w.find('[data-test="settings-assistant-grants-unsupported"]').exists()).toBe(false);
  });

  it("revokes without a confirm and toasts what happens next", async () => {
    vi.mocked(assistantSettings.grants).mockResolvedValue([GRANT]);
    vi.mocked(assistantSettings.revokeGrant).mockResolvedValue();
    const w = (wrapper = await mountTab(PermissionsTab, true));
    const revoke = w.find('[data-test="settings-assistant-grant-g1-revoke"]');
    expect(revoke.attributes("aria-label")).toBe("Revoke always-allow for alerts · update");
    await revoke.trigger("click");
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(assistantSettings.revokeGrant).toHaveBeenCalledWith("acme", "g1");
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Approval revoked. The assistant will ask next time." }),
    );
  });
});

describe("ActivityTab", () => {
  it("fabricates nothing without the activity API", async () => {
    vi.mocked(assistantSettings.activity).mockResolvedValue(null);
    const w = (wrapper = await mountTab(ActivityTab));
    expect(w.find('[data-test="settings-assistant-activity-unsupported"]').text()).toContain(
      "Activity history needs a newer server version.",
    );
    expect(w.find('[data-test="settings-assistant-activity-table"]').exists()).toBe(false);
  });

  it("reads the last seven days and undoes only after the confirm", async () => {
    vi.mocked(assistantSettings.activity).mockResolvedValue({ rows: [ENTRY], next_cursor: "n1" });
    vi.mocked(assistantSettings.undoActivity).mockResolvedValue();
    confirm.mockResolvedValue(true);
    const w = (wrapper = await mountTab(ActivityTab, true));
    const filter = vi.mocked(assistantSettings.activity).mock.calls[0][1]!;
    expect(filter.to! - filter.from!).toBe(7 * 86_400_000_000);
    expect(w.text()).toContain("Approved by bob@example.com");
    expect(w.find("s").text()).toBe("checkout-latency-old");
    await w.find('[data-test="settings-assistant-activity-a1-undo"]').trigger("click");
    await settle();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ focusCancel: true }));
    expect(assistantSettings.undoActivity).toHaveBeenCalledWith("acme", "a1");
  });

  it("pages forward with the server cursor", async () => {
    vi.mocked(assistantSettings.activity).mockResolvedValue({ rows: [ENTRY], next_cursor: "n1" });
    const w = (wrapper = await mountTab(ActivityTab, true));
    await w.find('[data-test="settings-assistant-activity-next"]').trigger("click");
    await settle();
    const last = vi.mocked(assistantSettings.activity).mock.calls.at(-1)![1]!;
    expect(last.cursor).toBe("n1");
  });

  it("moves the window to now on Refresh so newer actions appear", async () => {
    vi.mocked(assistantSettings.activity).mockResolvedValue({ rows: [ENTRY] });
    const w = (wrapper = await mountTab(ActivityTab, true));
    const first = vi.mocked(assistantSettings.activity).mock.calls[0][1]!;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await (w.vm as unknown as { refresh: () => Promise<unknown> }).refresh();
    await settle();
    const last = vi.mocked(assistantSettings.activity).mock.calls.at(-1)![1]!;
    expect(last.to!).toBeGreaterThan(first.to!);
    expect(last.cursor).toBeUndefined();
  });

  it("shows an undone row without Undo and names the time range select", async () => {
    vi.mocked(assistantSettings.activity).mockResolvedValue({
      rows: [{ ...ENTRY, result: { state: "undone" }, undo: { available: false } }],
    });
    const w = (wrapper = await mountTab(ActivityTab, true));
    expect(w.find('[data-test="settings-assistant-activity-a1-result"]').text()).toBe("Undone");
    expect(w.find('[data-test="settings-assistant-activity-a1-undo"]').exists()).toBe(false);
    expect(
      w.find('[data-test="settings-assistant-activity-range-trigger"]').attributes("aria-label"),
    ).toBe("Time range");
  });
});
