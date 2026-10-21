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

import AssistantOrgPolicyForm from "./AssistantOrgPolicyForm.vue";
import { ORG_SETTINGS, settingsHarness } from "./assistantSettings.test-helpers";

const { fake, confirm, toast } = vi.hoisted(() => ({
  fake: {
    current: null as ReturnType<
      typeof import("@/components/ai-assistant/__tests__/fakeAssistant").fakeAssistant
    > | null,
  },
  confirm: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantCapability: () => fake.current!.handle,
}));
vi.mock("@/composables/useConfirmDialog", () => ({ useConfirmDialog: () => ({ confirm }) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));
vi.mock("@/services/assistant_settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/assistant_settings")>();
  return { ...actual, default: { get: vi.fn(), update: vi.fn() } };
});
vi.mock("@/services/assistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/assistant")>();
  return { ...actual, default: { capabilities: vi.fn() } };
});

async function settle() {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

async function mountForm(zoConfig: Record<string, unknown> = {}) {
  const h = settingsHarness(zoConfig);
  const w = mount(AssistantOrgPolicyForm, {
    global: { plugins: h.plugins },
    attachTo: document.body,
  });
  await settle();
  return w;
}

const find = (w: Awaited<ReturnType<typeof mountForm>>, id: string) =>
  w.find(`[data-test="${id}"]`);
const switchOf = (w: Awaited<ReturnType<typeof mountForm>>, id: string) =>
  find(w, `${id}`).find('[role="switch"]');

let wrapper: Awaited<ReturnType<typeof mountForm>> | null = null;

beforeEach(() => {
  fake.current = fakeAssistant("available");
  vi.mocked(assistantSettings.get).mockResolvedValue({ ...ORG_SETTINGS });
  vi.mocked(assistantSettings.update).mockImplementation(async (_org, body) => ({
    ...ORG_SETTINGS,
    ...body,
  }));
  vi.mocked(assistant.capabilities).mockResolvedValue({ policy_enforced: true });
  confirm.mockResolvedValue(true);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("AssistantOrgPolicyForm", () => {
  it("renders the switches, tier group and Who can use it with each consequence as the description", async () => {
    wrapper = await mountForm();
    const enabled = switchOf(wrapper, "settings-assistant-enabled-switch");
    const line = document.getElementById(enabled.attributes("aria-describedby")!);
    expect(line?.textContent).toContain("Past chats stay readable.");
    expect(find(wrapper, "settings-assistant-tier-group").exists()).toBe(true);
    expect(find(wrapper, "settings-assistant-who").exists()).toBe(true);
    expect(find(wrapper, "settings-assistant-policy-save").exists()).toBe(true);
  });

  it("is read-only at the deployment values with one notice when the server has no org settings", async () => {
    vi.mocked(assistantSettings.get).mockResolvedValue(null);
    wrapper = await mountForm({ public_ai_chat_enabled: false });
    expect(find(wrapper, "settings-assistant-access-notice").text()).toContain(
      "Per-organization controls need a newer server version.",
    );
    expect(find(wrapper, "settings-assistant-env-O2_AI_ENABLED").exists()).toBe(true);
    expect(find(wrapper, "settings-assistant-env-ZO_PUBLIC_AI_CHAT_ENABLED").exists()).toBe(true);
    expect(
      switchOf(wrapper, "settings-assistant-enabled-switch").attributes("disabled"),
    ).toBeDefined();
    expect(switchOf(wrapper, "settings-assistant-enabled-switch").attributes("aria-checked")).toBe(
      "true",
    );
    expect(
      switchOf(wrapper, "settings-assistant-public-sharing-switch").attributes("aria-checked"),
    ).toBe("false");
    expect(find(wrapper, "settings-assistant-policy-save").exists()).toBe(false);
  });

  it("offers only Act with approval when the server does not enforce the policy", async () => {
    vi.mocked(assistant.capabilities).mockResolvedValue({ policy_enforced: false });
    wrapper = await mountForm();
    expect(find(wrapper, "settings-assistant-tier-read").attributes("disabled")).toBeDefined();
    expect(find(wrapper, "settings-assistant-tier-propose").attributes("disabled")).toBeDefined();
    expect(
      find(wrapper, "settings-assistant-tier-act_with_approval").attributes("disabled"),
    ).toBeUndefined();
    expect(find(wrapper, "settings-assistant-tier-needs-agent").text()).toBe(
      "Needs a newer agent version to enforce",
    );
  });

  it("disables public links the deployment forbids, with the reason", async () => {
    wrapper = await mountForm({ public_ai_chat_enabled: false });
    const sw = switchOf(wrapper, "settings-assistant-public-sharing-switch");
    expect(sw.attributes("disabled")).toBeDefined();
    expect(document.getElementById(sw.attributes("aria-describedby")!)?.textContent).toContain(
      "Public links are off for this deployment (ZO_PUBLIC_AI_CHAT_ENABLED).",
    );
  });

  it("confirms turning the assistant off with Cancel focused, then saves the five keys and toasts", async () => {
    wrapper = await mountForm();
    await switchOf(wrapper, "settings-assistant-enabled-switch").trigger("click");
    await find(wrapper, "settings-assistant-policy-form").trigger("submit");
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({
      message:
        "Turn off O2 Assistant for Acme? Running answers will be stopped. Members keep their chat history.",
      confirmVariant: "destructive",
      focusCancel: true,
    });
    expect(assistantSettings.update).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        enabled: false,
        permission_tier: "act_with_approval",
        org_sharing: true,
        public_sharing: true,
        data_sharing_level: "raw",
      }),
    );
    expect(toast).toHaveBeenCalledWith({
      variant: "success",
      message: "O2 Assistant turned off for Acme",
    });
  });

  it("names the tier group by its label and describes it by the consequence line", async () => {
    wrapper = await mountForm();
    const group = find(wrapper, "settings-assistant-tier-group").find('[role="group"]');
    const label = document.getElementById(group.attributes("aria-labelledby")!);
    expect(label?.textContent?.trim()).toBe("Default permission tier");
    const line = document.getElementById(group.attributes("aria-describedby")!);
    expect(line?.textContent).toContain("approval");
  });

  it("keeps the stored public-links value under a deployment lock and asks nothing about it", async () => {
    vi.mocked(assistantSettings.get).mockResolvedValue({ ...ORG_SETTINGS, public_link_count: 3 });
    wrapper = await mountForm({ public_ai_chat_enabled: false });
    expect(
      switchOf(wrapper, "settings-assistant-public-sharing-switch").attributes("aria-checked"),
    ).toBe("false");
    await find(wrapper, "settings-assistant-tier-read").trigger("click");
    await find(wrapper, "settings-assistant-policy-form").trigger("submit");
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(assistantSettings.update).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ permission_tier: "read", public_sharing: true }),
    );
  });

  it("shows an unenforced stored tier as the one applied, and never rewrites it", async () => {
    vi.mocked(assistant.capabilities).mockResolvedValue({ policy_enforced: false });
    vi.mocked(assistantSettings.get).mockResolvedValue({
      ...ORG_SETTINGS,
      permission_tier: "propose",
    });
    wrapper = await mountForm();
    expect(
      find(wrapper, "settings-assistant-tier-act_with_approval").attributes("data-state"),
    ).toBe("on");
    expect(find(wrapper, "settings-assistant-tier-stored").text()).toBe(
      "Saved tier: Propose changes. It applies once the agent can enforce it.",
    );
    await switchOf(wrapper, "settings-assistant-org-sharing-switch").trigger("click");
    await find(wrapper, "settings-assistant-policy-form").trigger("submit");
    await settle();
    expect(assistantSettings.update).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ permission_tier: "propose", org_sharing: false }),
    );
  });

  it("puts only the edited key on a fresh read, so another admin's turn-off survives", async () => {
    wrapper = await mountForm();
    vi.mocked(assistantSettings.get).mockResolvedValue({ ...ORG_SETTINGS, enabled: false });
    await switchOf(wrapper, "settings-assistant-org-sharing-switch").trigger("click");
    await find(wrapper, "settings-assistant-policy-form").trigger("submit");
    await settle();
    expect(assistantSettings.update).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ enabled: false, org_sharing: false }),
    );
  });

  it("states each read-only switch value in words", async () => {
    vi.mocked(assistantSettings.get).mockResolvedValue(null);
    wrapper = await mountForm();
    expect(find(wrapper, "settings-assistant-enabled-value").text()).toBe("On");
    expect(find(wrapper, "settings-assistant-enabled-value").attributes("aria-hidden")).toBe(
      "true",
    );
  });

  it("writes nothing when the turn-off confirm is cancelled", async () => {
    confirm.mockResolvedValue(false);
    wrapper = await mountForm();
    await switchOf(wrapper, "settings-assistant-enabled-switch").trigger("click");
    await find(wrapper, "settings-assistant-policy-form").trigger("submit");
    await settle();
    expect(assistantSettings.update).not.toHaveBeenCalled();
  });

  it("confirms turning public links off with the count of links that stop working", async () => {
    vi.mocked(assistantSettings.get).mockResolvedValue({ ...ORG_SETTINGS, public_link_count: 3 });
    wrapper = await mountForm();
    await switchOf(wrapper, "settings-assistant-public-sharing-switch").trigger("click");
    await find(wrapper, "settings-assistant-policy-form").trigger("submit");
    await settle();
    expect(confirm.mock.calls[0][0].message).toBe("3 existing links stop working.");
    expect(assistantSettings.update).toHaveBeenCalledTimes(1);
  });

  it("saves a change without a confirm when nothing is being turned off", async () => {
    wrapper = await mountForm();
    await switchOf(wrapper, "settings-assistant-org-sharing-switch").trigger("click");
    await find(wrapper, "settings-assistant-policy-form").trigger("submit");
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ variant: "success", message: "Assistant settings saved" });
  });

  it("adds no toast of its own when the save fails", async () => {
    vi.mocked(assistantSettings.update).mockRejectedValue(
      Object.assign(new Error("no"), { response: { status: 403 } }),
    );
    wrapper = await mountForm();
    await switchOf(wrapper, "settings-assistant-org-sharing-switch").trigger("click");
    await find(wrapper, "settings-assistant-policy-form").trigger("submit");
    await settle();
    expect(toast).not.toHaveBeenCalled();
  });

  it("disables every control for a member and renders no Save", async () => {
    fake.current = fakeAssistant("available", { isAdmin: false });
    wrapper = await mountForm();
    expect(
      switchOf(wrapper, "settings-assistant-enabled-switch").attributes("disabled"),
    ).toBeDefined();
    expect(find(wrapper, "settings-assistant-policy-save").exists()).toBe(false);
    expect(find(wrapper, "settings-assistant-own-access").text()).toBe("You: chat, share");
  });

  it("shows a load error with Retry, and the forbidden state on 403", async () => {
    vi.mocked(assistantSettings.get).mockRejectedValue(
      Object.assign(new Error("x"), { response: { status: 500 } }),
    );
    wrapper = await mountForm();
    expect(find(wrapper, "settings-assistant-policy-error").exists()).toBe(true);
    wrapper.unmount();
    vi.mocked(assistantSettings.get).mockRejectedValue(
      Object.assign(new Error("x"), { response: { status: 403 } }),
    );
    wrapper = await mountForm();
    expect(find(wrapper, "settings-assistant-policy-forbidden").text()).toContain(
      "You don't have access to this setting.",
    );
  });

  it("states that every user is an admin when RBAC is off", async () => {
    wrapper = await mountForm({ rbac_enabled: false });
    expect(find(wrapper, "settings-assistant-rbac-off").exists()).toBe(true);
    expect(find(wrapper, "settings-assistant-builtin-roles").exists()).toBe(false);
  });
});
