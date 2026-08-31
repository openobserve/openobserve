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
import { createStore } from "vuex";

import { resetPasswordComplexityCache } from "@/composables/usePasswordComplexity";
import { usePasswordReset } from "@/composables/usePasswordReset";
import i18n from "@/locales";

import UpdatePasswordDialog from "./UpdatePasswordDialog.vue";

// Reka portals dialog content into <body>. Render it inline so the assertions can reach it —
// the same stub ODialog's own spec uses.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return { ...actual, DialogPortal: actual.DialogContent };
});

vi.mock("@/services/passwordPolicy", () => ({
  default: { getComplexity: vi.fn(), getPolicy: vi.fn(), updatePolicy: vi.fn() },
}));

vi.mock("@/services/users", () => ({
  default: { update: vi.fn() },
}));

const toastMock = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

const pushMock = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const invalidateLoginDataMock = vi.fn();
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    invalidateLoginData: (...args: unknown[]) => invalidateLoginDataMock(...args),
    useLocalCurrentUser: vi.fn(),
    useLocalUserInfo: vi.fn(),
  };
});

import passwordPolicyService from "@/services/passwordPolicy";
import userService from "@/services/users";

const STRICT_COMPLEXITY = {
  min_length: 12,
  max_length: 64,
  require_uppercase: true,
  require_lowercase: true,
  require_digit: true,
  require_special: true,
  special_char_set: "",
};

const store = createStore({
  state: {
    userInfo: { email: "maya@acme.io" },
    selectedOrganization: { identifier: "acme" },
    zoConfig: { meta_org: "_meta" },
  },
  actions: { logout: vi.fn() },
});

let wrappers: any[] = [];

const mountDialog = () => {
  const wrapper = mount(UpdatePasswordDialog, {
    global: {
      plugins: [i18n, store],
      stubs: { teleport: true },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
};

const { open, close, isOpen, isPasswordResetError } = usePasswordReset();

describe("usePasswordReset", () => {
  beforeEach(() => close());

  it("recognises only the middleware's reset-required 403", () => {
    expect(
      isPasswordResetError({
        response: { status: 403, data: { code: "password_reset_required" } },
      }),
    ).toBe(true);
    // A plain 403 is an authorization failure and belongs to the existing handler.
    expect(isPasswordResetError({ response: { status: 403, data: {} } })).toBe(false);
    expect(isPasswordResetError({ response: { status: 401 } })).toBe(false);
    expect(isPasswordResetError(undefined)).toBe(false);
  });

  it("opens once however many rejections arrive", () => {
    open("policy_tightened");
    open("rotation_expired");
    open("rotation_expired");

    expect(isOpen.value).toBe(true);
    // The first reason wins: six parallel requests must not rewrite the banner under the user.
    expect(usePasswordReset().reason.value).toBe("policy_tightened");
  });

  it("falls back to policy_tightened for an unrecognised reason", () => {
    open("something-else");

    expect(usePasswordReset().reason.value).toBe("policy_tightened");
  });
});

describe("UpdatePasswordDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPasswordComplexityCache();
    close();
    (passwordPolicyService.getComplexity as any).mockResolvedValue({ data: STRICT_COMPLEXITY });
    (userService.update as any).mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    wrappers.forEach((wrapper) => wrapper.unmount());
    wrappers = [];
    close();
  });

  it("renders nothing until the user is flagged", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    expect(wrapper.find('[data-test="password-reset-dialog"]').exists()).toBe(false);
  });

  it("reads the complexity when it opens", async () => {
    open("policy_tightened");
    mountDialog();
    await flushPromises();

    expect(passwordPolicyService.getComplexity).toHaveBeenCalledWith("acme");
  });

  it("still fetches the complexity when no organization is selected", async () => {
    // The blocked user's org-list request is one of the calls the middleware refuses, so no
    // organization is ever selected for them. Building the URL from selectedOrganization sent
    // /api/undefined/password_complexity, and the dialog silently showed the compiled defaults
    // instead of the policy the server was actually enforcing.
    store.state.selectedOrganization = undefined as any;

    open("policy_tightened");
    mountDialog();
    await flushPromises();

    expect(passwordPolicyService.getComplexity).toHaveBeenCalledWith("default");

    store.state.selectedOrganization = { identifier: "acme" } as any;
  });

  it("submits the password change to a real org when none is selected", async () => {
    // Same root cause as above, with a nastier symptom: the PUT went to /api/undefined/users/...,
    // which 401s, and http.ts's global 401 handler force-logs-out — so a change that never
    // happened looked exactly like one that succeeded.
    store.state.selectedOrganization = undefined as any;

    open("policy_tightened");
    const wrapper = mountDialog();
    await flushPromises();

    await (wrapper.vm as any).submit({
      old_password: "old-secret",
      new_password: "New-Secret-1!",
      confirm_password: "New-Secret-1!",
    });
    await flushPromises();

    expect(userService.update).toHaveBeenCalledWith(expect.anything(), "default", "maya@acme.io");

    store.state.selectedOrganization = { identifier: "acme" } as any;
  });

  it("builds the checklist from the policy, not a hardcoded list", async () => {
    open("policy_tightened");
    const wrapper = mountDialog();
    await flushPromises();

    for (const key of ["minLength", "maxLength", "uppercase", "lowercase", "digit", "special"]) {
      expect(wrapper.find(`[data-test="password-requirement-${key}"]`).exists()).toBe(true);
    }
  });

  it("shows one row for a policy that enforces one thing", async () => {
    (passwordPolicyService.getComplexity as any).mockResolvedValue({
      data: {
        ...STRICT_COMPLEXITY,
        max_length: 0,
        require_uppercase: false,
        require_lowercase: false,
        require_digit: false,
        require_special: false,
      },
    });

    open("policy_tightened");
    const wrapper = mountDialog();
    await flushPromises();

    expect(wrapper.findAll('[data-test^="password-requirement-"]')).toHaveLength(1);
    expect(wrapper.find('[data-test="password-requirement-minLength"]').exists()).toBe(true);
  });

  it("ticks requirements as the new password is typed", async () => {
    open("policy_tightened");
    const wrapper = mountDialog();
    await flushPromises();

    const metBefore = wrapper
      .find('[data-test="password-requirement-uppercase"]')
      .classes()
      .join(" ");
    expect(metBefore).toContain("text-text-secondary");

    await wrapper
      .find('[data-test="password-reset-dialog-new-password"] input')
      .setValue("Abcdefghijk1!");
    await flushPromises();

    const metAfter = wrapper
      .find('[data-test="password-requirement-uppercase"]')
      .classes()
      .join(" ");
    expect(metAfter).toContain("text-status-positive");
  });

  it("never advertises a rule the server does not enforce", async () => {
    open("policy_tightened");
    const wrapper = mountDialog();
    await flushPromises();

    // The mockup lists it; PasswordPolicy has no such field.
    expect(wrapper.text()).not.toContain("email");
  });

  it("still renders a usable form when the complexity fetch fails", async () => {
    (passwordPolicyService.getComplexity as any).mockRejectedValue(new Error("nope"));

    open("policy_tightened");
    const wrapper = mountDialog();
    await flushPromises();

    expect(wrapper.find('[data-test="password-reset-dialog-new-password"]').exists()).toBe(true);
  });

  it("shows the reason the middleware gave", async () => {
    open("rotation_expired");
    const wrapper = mountDialog();
    await flushPromises();

    expect(wrapper.find('[data-test="password-reset-dialog-banner"]').text()).toContain("expired");
  });

  it("submits the change_password payload for the signed-in user", async () => {
    open("policy_tightened");
    const wrapper = mountDialog();
    await flushPromises();

    await (wrapper.vm as any).submit({
      old_password: "old-secret",
      new_password: "New-Secret-1!",
      confirm_password: "New-Secret-1!",
    });
    await flushPromises();

    expect(userService.update).toHaveBeenCalledWith(
      { change_password: true, old_password: "old-secret", new_password: "New-Secret-1!" },
      "acme",
      "maya@acme.io",
    );
  });

  it("signs the user out on success, because the cookie is the old password", async () => {
    open("policy_tightened");
    const wrapper = mountDialog();
    await flushPromises();

    await (wrapper.vm as any).submit({
      old_password: "old-secret",
      new_password: "New-Secret-1!",
      confirm_password: "New-Secret-1!",
    });
    await flushPromises();

    expect(invalidateLoginDataMock).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/logout");
    expect(isOpen.value).toBe(false);
  });

  it("keeps the dialog open and does not sign out when the current password is wrong", async () => {
    (userService.update as any).mockRejectedValue({
      response: { data: { message: "Invalid old password" } },
    });

    open("policy_tightened");
    const wrapper = mountDialog();
    await flushPromises();

    await (wrapper.vm as any).submit({
      old_password: "wrong",
      new_password: "New-Secret-1!",
      confirm_password: "New-Secret-1!",
    });
    await flushPromises();

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "Invalid old password" }),
    );
    expect(pushMock).not.toHaveBeenCalled();
    expect(isOpen.value).toBe(true);
  });
});
