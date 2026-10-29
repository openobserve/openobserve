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
import aiToolsets from "@/services/ai_toolsets";
import assistant from "@/services/assistant";
import assistantSettings from "@/services/assistant_settings";

import ToolsetsTab from "./ToolsetsTab.vue";
import { settingsHarness } from "./assistantSettings.test-helpers";

const { fake, toast, confirm, viewport } = vi.hoisted(() => ({
  viewport: { mdUp: true },
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
vi.mock("@/composables/useBreakpoint", async (importOriginal) => {
  const { computed } = await import("vue");
  const actual = await importOriginal<typeof import("@/composables/useBreakpoint")>();
  return {
    ...actual,
    default: () => ({ ...actual.default(), mdUp: computed(() => viewport.mdUp) }),
  };
});
vi.mock("@/composables/useConfirmDialog", () => ({ useConfirmDialog: () => ({ confirm }) }));
vi.mock("@/components/CodeQueryEditor.vue", () => ({ default: { render: () => null } }));
vi.mock("@/services/ai_toolsets", () => ({
  default: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/services/assistant_settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/assistant_settings")>();
  return { ...actual, default: { setToolsetEnabled: vi.fn(), testToolset: vi.fn() } };
});
vi.mock("@/services/assistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/assistant")>();
  return { ...actual, default: { capabilities: vi.fn(), testCapabilities: vi.fn() } };
});

const ROWS = [
  { id: "1", name: "pagerduty", kind: "mcp", description: "Pages people" },
  { id: "2", name: "My_Tool", kind: "skill" },
  {
    id: "3",
    name: "my-tool",
    kind: "cli",
    data: { command: "kubectl", requires_confirmation: false },
  },
];

async function settle() {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

async function mountTab(rows: unknown[] = ROWS) {
  vi.mocked(aiToolsets.list).mockResolvedValue({ data: { toolsets: rows } } as never);
  const h = settingsHarness();
  await h.router.push("/settings/assistant/toolsets");
  const w = mount(ToolsetsTab, { global: { plugins: h.plugins }, attachTo: document.body });
  await settle();
  // OTable holds its loading state for a moment, so the rows land a few ticks after the data.
  if (rows.length)
    await vi.waitFor(() => expect(w.find('[data-test="o2-table-row-0"]').exists()).toBe(true));
  return { w, router: h.router };
}

let wrapper: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  fake.current = fakeAssistant("available");
  vi.mocked(assistant.capabilities).mockResolvedValue({ health: { status: "ok" } });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("ToolsetsTab", () => {
  it("hides the health columns and says why on a server without them", async () => {
    const { w } = await mountTab();
    wrapper = w;
    expect(w.find('[data-test="ai-toolsets-health-unsupported"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-toolset-pagerduty-enabled"]').exists()).toBe(false);
    expect(w.find('[data-test="ai-toolset-pagerduty-test"]').exists()).toBe(false);
    expect(w.find('[data-test="ai-toolsets-footer-note"]').text()).toContain(
      "Enabled toolsets are available to O2 Assistant and to incident analysis",
    );
    expect(w.find('[data-test="settings-assistant-mcp-link"]').exists()).toBe(true);
  });

  it("draws the MCP link in the darker link step, which keeps AA on any theme colour", async () => {
    const { w } = await mountTab();
    wrapper = w;
    const link = w.get('[data-test="settings-assistant-mcp-link"]').classes();
    expect(link).toContain("text-text-link-hover");
    expect(link).not.toContain("text-text-link");
  });

  it("marks both rows of a name clash and an unguarded CLI toolset", async () => {
    const { w } = await mountTab();
    wrapper = w;
    expect(w.find('[data-test="ai-toolset-My_Tool-clash"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-toolset-my-tool-clash"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-toolset-pagerduty-clash"]').exists()).toBe(false);
    expect(w.find('[data-test="ai-toolset-my-tool-unguarded"]').exists()).toBe(true);
  });

  it("rolls the switch back and toasts when enabling fails", async () => {
    vi.mocked(assistantSettings.setToolsetEnabled).mockRejectedValue(new Error("boom"));
    const { w } = await mountTab([
      { ...ROWS[0], enabled: true, status: { state: "ok" }, last_used_at: 1 },
    ]);
    wrapper = w;
    const button = w.find('[data-test="ai-toolset-pagerduty-enabled-btn"]');
    expect(button.attributes("aria-checked")).toBe("true");
    await button.trigger("click");
    await settle();
    expect(assistantSettings.setToolsetEnabled).toHaveBeenCalledWith("acme", "1", false);
    expect(
      w.find('[data-test="ai-toolset-pagerduty-enabled-btn"]').attributes("aria-checked"),
    ).toBe("true");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("shows a test result in the row and announces it once", async () => {
    vi.mocked(assistantSettings.testToolset).mockResolvedValue({ ok: true, duration_ms: 180 });
    const { w } = await mountTab([{ ...ROWS[0], enabled: true, status: { state: "never_used" } }]);
    wrapper = w;
    await w.find('[data-test="ai-toolset-pagerduty-test"]').trigger("click");
    await settle();
    expect(w.find('[data-test="ai-toolset-status"]').text()).toContain("OK · 180 ms");
    expect(w.find('[data-test="ai-toolsets-announce"]').text()).toBe(
      "Test passed for pagerduty in 180 ms",
    );
  });

  it("deletes only after the confirm and the server agree", async () => {
    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.mocked(aiToolsets.delete).mockResolvedValue({} as never);
    const { w } = await mountTab();
    wrapper = w;
    await w.find('[data-test="ai-toolset-pagerduty-delete"]').trigger("click");
    await settle();
    expect(aiToolsets.delete).not.toHaveBeenCalled();
    await w.find('[data-test="ai-toolset-pagerduty-delete"]').trigger("click");
    await settle();
    expect(confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Delete pagerduty?", focusCancel: true }),
    );
    expect(aiToolsets.delete).toHaveBeenCalledWith("acme", "1");
  });

  it("filters by the displayed kind label", async () => {
    const { w } = await mountTab();
    wrapper = w;
    await w.find('[data-test="ai-toolsets-search"] input').setValue("MCP server");
    await settle();
    expect(w.text()).toContain("pagerduty");
    expect(w.text()).not.toContain("My_Tool");
  });

  it("leaves editing to the server's Toolsets permission, then turns read-only on a 403", async () => {
    fake.current = fakeAssistant("available", { isAdmin: false });
    vi.mocked(assistantSettings.setToolsetEnabled).mockRejectedValue({ response: { status: 403 } });
    const { w } = await mountTab([{ ...ROWS[0], enabled: true, status: { state: "ok" } }]);
    wrapper = w;
    expect(w.find('[data-test="ai-toolsets-add-btn"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-toolsets-view-only"]').exists()).toBe(false);
    await w.find('[data-test="ai-toolset-pagerduty-enabled-btn"]').trigger("click");
    await settle();
    expect(toast).not.toHaveBeenCalled();
    expect(w.find('[data-test="ai-toolsets-view-only"]').text()).toBe(
      "You can view toolsets. Editing needs the Toolsets permission in IAM › Roles.",
    );
    expect(w.find('[data-test="ai-toolsets-add-btn"]').exists()).toBe(false);
    expect(w.find('[data-test="ai-toolset-pagerduty-delete"]').exists()).toBe(false);
  });

  it("names the icon-only refresh button on a phone and keeps the kind tag neutral", async () => {
    viewport.mdUp = false;
    const { w } = await mountTab();
    viewport.mdUp = true;
    wrapper = w;
    expect(w.find('[data-test="ai-toolsets-list-refresh-btn"]').attributes("aria-label")).toBe(
      "Refresh toolsets",
    );
    expect(w.find('[data-test="o2-table-row-0"]').html()).not.toMatch(/primary-soft|success-soft/);
  });

  it("announces a failed test without a dangling cause", async () => {
    vi.mocked(assistantSettings.testToolset).mockResolvedValue({ ok: false });
    const { w } = await mountTab([{ ...ROWS[0], enabled: true, status: { state: "ok" } }]);
    wrapper = w;
    await w.find('[data-test="ai-toolset-pagerduty-test"]').trigger("click");
    await settle();
    expect(w.find('[data-test="ai-toolsets-announce"]').text()).toBe("Test failed for pagerduty");
    expect(w.find('[data-test="ai-toolset-status"]').text()).toContain("Failing since just now");
    expect(w.find('[data-test="ai-toolset-status"]').text()).not.toContain("·");
  });

  it("waits for capabilities before it opens the form, so secret rows match the server", async () => {
    let answer: (value: unknown) => void = () => {};
    vi.mocked(assistant.capabilities).mockImplementation(
      () => new Promise((resolve) => (answer = resolve)) as never,
    );
    vi.mocked(aiToolsets.list).mockResolvedValue({ data: { toolsets: ROWS } } as never);
    vi.mocked(aiToolsets.get).mockResolvedValue({
      data: { ...ROWS[0], data: { url: "https://x", headers: { Authorization: "***" } } },
    } as never);
    const h = settingsHarness();
    await h.router.push("/settings/assistant/toolsets?action=edit&id=1");
    const w = (wrapper = mount(ToolsetsTab, {
      global: { plugins: h.plugins },
      attachTo: document.body,
    }));
    await settle();
    expect(w.find('[data-test="ai-toolset-form-capabilities-loading"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-toolset-form"]').exists()).toBe(false);
    answer({ health: { status: "ok" }, toolset_secret_merge: true });
    await settle();
    await vi.waitFor(() =>
      expect(w.find('[data-test="ai-toolset-header-0-unchanged"]').exists()).toBe(true),
    );
  });

  it("opens the form in place from the add query", async () => {
    const { w, router } = await mountTab();
    wrapper = w;
    await w.find('[data-test="ai-toolsets-add-btn"]').trigger("click");
    await settle();
    expect(router.currentRoute.value.query.action).toBe("add");
    expect(w.find('[data-test="ai-toolset-form"]').exists()).toBe(true);
  });
});
