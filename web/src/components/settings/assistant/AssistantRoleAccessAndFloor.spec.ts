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

import { fakeAssistant } from "@/components/ai-assistant/__tests__/fakeAssistant";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import BillingService from "@/services/billings";
import { getResourcePermission, getRoles } from "@/services/iam";

import AssistantAllowanceFloor from "./AssistantAllowanceFloor.vue";
import AssistantRoleChatAccess from "./AssistantRoleChatAccess.vue";
import { settingsHarness } from "./assistantSettings.test-helpers";

const { fake } = vi.hoisted(() => ({
  fake: {
    current: null as ReturnType<
      typeof import("@/components/ai-assistant/__tests__/fakeAssistant").fakeAssistant
    > | null,
  },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantCapability: () => fake.current!.handle,
}));
vi.mock("@/services/iam", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/iam")>()),
  getRoles: vi.fn(),
  getResourcePermission: vi.fn(),
}));
vi.mock("@/services/billings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/billings")>();
  return { ...actual, default: { ...actual.default, get_ai_usage: vi.fn() } };
});

async function settle() {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

beforeEach(() => {
  fake.current = fakeAssistant("available");
});

afterEach(() => vi.clearAllMocks());

describe("AssistantRoleChatAccess", () => {
  it("lists roles with chat access and links Grant chat to the focused editor", async () => {
    vi.mocked(getRoles).mockResolvedValue({ data: ["analyst", "oncall"] } as never);
    vi.mocked(getResourcePermission).mockImplementation(
      ({ role_name }) =>
        Promise.resolve({
          data:
            role_name === "oncall" ? [{ object: "ai:_all_default", permission: "AllowPut" }] : [],
        }) as never,
    );
    const harness = settingsHarness();
    const w = mount(AssistantRoleChatAccess, { global: { plugins: harness.plugins } });
    await settle();
    await vi.waitFor(() =>
      expect(w.find('[data-test="settings-assistant-role-oncall-access"]').text()).toBe("Can chat"),
    );
    expect(w.find('[data-test="settings-assistant-grant-chat-oncall"]').exists()).toBe(false);
    const grant = w.find('[data-test="settings-assistant-grant-chat-analyst"]');
    expect(grant.attributes("href")).toBe(
      "/iam/roles/edit/analyst?org_identifier=acme&module=assistant&focus=ai",
    );
    expect(grant.attributes("aria-label")).toBe("Grant chat to analyst");
  });

  it("says how many roles it left out and links to all of them", async () => {
    const roles = Array.from({ length: 53 }, (_, i) => `role-${i}`);
    vi.mocked(getRoles).mockResolvedValue({ data: roles } as never);
    let inFlight = 0;
    let peak = 0;
    vi.mocked(getResourcePermission).mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return { data: [] } as never;
    });
    const harness = settingsHarness();
    const w = mount(AssistantRoleChatAccess, { global: { plugins: harness.plugins } });
    await vi.waitFor(() =>
      expect(w.find('[data-test="settings-assistant-role-access-capped"]').exists()).toBe(true),
    );
    expect(w.find('[data-test="settings-assistant-role-access-capped"]').text()).toBe(
      "Showing 50 of 53 roles. See all roles in IAM › Roles.",
    );
    expect(w.find('[data-test="settings-assistant-role-access-all"]').attributes("href")).toBe(
      "/iam/roles?org_identifier=acme",
    );
    expect(getResourcePermission).toHaveBeenCalledTimes(50);
    expect(peak).toBeLessThanOrEqual(6);
  });

  it("renders nothing for a member", async () => {
    fake.current = fakeAssistant("available", { isAdmin: false });
    const harness = settingsHarness();
    const w = mount(AssistantRoleChatAccess, { global: { plugins: harness.plugins } });
    await settle();
    expect(w.find('[data-test="settings-assistant-role-access"]').exists()).toBe(false);
    expect(getRoles).not.toHaveBeenCalled();
  });
});

describe("AssistantAllowanceFloor", () => {
  const Host = defineComponent({
    props: { used: { type: Number, required: true } },
    emits: ["below"],
    setup(props, { emit }) {
      return () =>
        h(OForm, { defaultValues: { creditsLimit: 200 } }, () => [
          h(OFormInput, { name: "creditsLimit", type: "number", "data-test": "limit" }),
          h(AssistantAllowanceFloor, {
            org: "child",
            used: props.used,
            field: "creditsLimit",
            "onUpdate:below": (value: boolean) => emit("below", value),
          }),
        ]);
    },
  });

  it("warns below current usage and shows the org's mode", async () => {
    vi.mocked(BillingService.get_ai_usage).mockResolvedValue({
      data: { mode: "pay_as_you_go" },
    } as never);
    const harness = settingsHarness();
    const w = mount(Host, { props: { used: 125 }, global: { plugins: harness.plugins } });
    await settle();
    expect(w.find('[data-test="ai-credits-limit-floor-warning"]').exists()).toBe(false);
    await w.find('[data-test="limit"] input').setValue("100");
    await settle();
    expect(w.find('[data-test="ai-credits-limit-floor-warning"]').text()).toBe(
      "Below current usage (125). The organization is blocked immediately unless paid usage is on.",
    );
    expect(w.emitted("below")!.at(-1)).toEqual([true]);
    expect(BillingService.get_ai_usage).toHaveBeenCalledWith("child");
  });

  it("says the mode is unavailable when that org's usage cannot be read", async () => {
    vi.mocked(BillingService.get_ai_usage).mockRejectedValue(new Error("403"));
    const harness = settingsHarness();
    const w = mount(Host, { props: { used: 0 }, global: { plugins: harness.plugins } });
    await settle();
    await vi.waitFor(() =>
      expect(w.find('[data-test="ai-credits-limit-mode"]').text()).toContain("Mode unavailable"),
    );
  });
});
