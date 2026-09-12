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

import i18n from "@/locales";
import type { PasswordPolicy as PasswordPolicyType } from "@/services/passwordPolicy";

import PasswordPolicy from "./PasswordPolicy.vue";
import { buildPolicyPayload, complexityDefaults } from "./PasswordPolicy.schema";

vi.mock("@/services/passwordPolicy", () => ({
  default: {
    getPolicy: vi.fn(),
    updatePolicy: vi.fn(),
    getComplexity: vi.fn(),
  },
}));

const confirmMock = vi.fn();
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

const toastMock = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

import passwordPolicyService from "@/services/passwordPolicy";

// A policy with every non-complexity feature configured — the values a complexity-only edit must
// carry back untouched.
const CONFIGURED_POLICY: PasswordPolicyType = {
  min_length: 10,
  max_length: 64,
  require_uppercase: true,
  require_lowercase: false,
  require_digit: false,
  require_special: false,
  special_char_set: "",
  rotation_days: 90,
  rotation_warning_days: 7,
  history_count: 5,
  history_max_retained: 30,
  lockout: {
    threshold: 5,
    bucket_size: 3,
    start_secs: 120,
    max_secs: 7200,
    backoff: "linear",
  },
  enforcement_mode: "hard_block",
};

const store = createStore({
  state: {
    zoConfig: { meta_org: "_meta" },
    selectedOrganization: { identifier: "_meta" },
  },
});

// Tracked so every mount is torn down: a live component left over from an earlier case keeps
// resolving its own load promise and writes into the mocks the next case is asserting on.
let wrappers: any[] = [];

const mountPage = () => {
  const wrapper = mount(PasswordPolicy, {
    global: {
      plugins: [i18n, store],
      stubs: { OSpinner: true },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
};

// Drives the real form rather than calling the handler, so field coercion and the OForm submit
// path are covered too.
const editMinLength = async (wrapper: any, value: string) => {
  const input = wrapper.find('[data-test="settings-password-policy-min-length"] input');
  await input.setValue(value);
  await flushPromises();
};

// Awaits TanStack's own submit promise. A DOM `trigger("submit")` starts the same chain but
// returns before the awaited onSubmit settles, which makes the assertions race it.
const submit = async (wrapper: any) => {
  await wrapper.vm.form.handleSubmit();
  await flushPromises();
};

describe("PasswordPolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    (passwordPolicyService.getPolicy as any).mockResolvedValue({ data: CONFIGURED_POLICY });
    (passwordPolicyService.updatePolicy as any).mockResolvedValue({
      data: { policy: CONFIGURED_POLICY, users_flagged: 0 },
    });
  });

  afterEach(() => {
    wrappers.forEach((wrapper) => wrapper.unmount());
    wrappers = [];
  });

  it("reads the policy from the meta org", async () => {
    mountPage();
    await flushPromises();

    expect(passwordPolicyService.getPolicy).toHaveBeenCalledWith("_meta");
  });

  it("renders the complexity form once the policy loads", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-test="settings-password-policy-min-length"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="settings-password-policy-save-btn"]').exists()).toBe(true);
  });

  it("renders the not-admin empty state on a plain 403, with no form", async () => {
    (passwordPolicyService.getPolicy as any).mockRejectedValue({
      response: { status: 403, data: { message: "nope" } },
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-test="password-policy-not-admin-empty-state"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="settings-password-policy-save-btn"]').exists()).toBe(false);
  });

  it("does NOT render the not-admin state for a password_reset_required 403", async () => {
    // That 403 means the caller IS an admin who just flagged themselves; the reset dialog owns it.
    (passwordPolicyService.getPolicy as any).mockRejectedValue({
      response: { status: 403, data: { code: "password_reset_required" } },
    });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-test="password-policy-not-admin-empty-state"]').exists()).toBe(
      false,
    );
  });

  it("renders a retry-able error state for any other failure", async () => {
    (passwordPolicyService.getPolicy as any).mockRejectedValue({ response: { status: 500 } });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-test="password-policy-load-error-empty-state"]').exists()).toBe(
      true,
    );
  });

  it("keeps Save disabled until something changes", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const save = wrapper.find('[data-test="settings-password-policy-save-btn"]');
    expect(save.attributes("disabled")).toBeDefined();
  });

  it("confirms before writing and makes no request when cancelled", async () => {
    const wrapper = mountPage();
    await flushPromises();

    await editMinLength(wrapper, "16");
    confirmMock.mockResolvedValue(false);
    await submit(wrapper);
    await flushPromises();

    expect(confirmMock).toHaveBeenCalled();
    expect(passwordPolicyService.updatePolicy).not.toHaveBeenCalled();
  });

  it("posts a body that still carries rotation, reuse and lockout from the GET", async () => {
    const wrapper = mountPage();
    await flushPromises();

    await editMinLength(wrapper, "16");
    await submit(wrapper);

    const [, body] = (passwordPolicyService.updatePolicy as any).mock.calls[0];

    // The edited half.
    expect(body.min_length).toBe(16);
    // The half this page never shows — a PUT that dropped these would reset them server-side.
    expect(body.rotation_days).toBe(90);
    expect(body.rotation_warning_days).toBe(7);
    expect(body.history_count).toBe(5);
    expect(body.history_max_retained).toBe(30);
    expect(body.lockout).toEqual(CONFIGURED_POLICY.lockout);
    expect(body.enforcement_mode).toBe("hard_block");
  });

  it("reports the server's flagged count, not a locally predicted one", async () => {
    (passwordPolicyService.updatePolicy as any).mockResolvedValue({
      data: { policy: CONFIGURED_POLICY, users_flagged: 12 },
    });

    const wrapper = mountPage();
    await flushPromises();
    await editMinLength(wrapper, "16");
    await submit(wrapper);

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", message: expect.stringContaining("12") }),
    );
  });
});

describe("buildPolicyPayload", () => {
  it("overrides only the seven complexity fields", () => {
    const payload = buildPolicyPayload(CONFIGURED_POLICY, {
      min_length: 20,
      max_length: 0,
      require_uppercase: false,
      require_lowercase: true,
      require_digit: true,
      require_special: true,
      special_char_set: " !@# ",
    });

    expect(payload).toEqual({
      ...CONFIGURED_POLICY,
      min_length: 20,
      max_length: 0,
      require_uppercase: false,
      require_lowercase: true,
      require_digit: true,
      require_special: true,
      special_char_set: "!@#",
    });
  });

  it("clears the special set when the requirement is off", () => {
    const payload = buildPolicyPayload(CONFIGURED_POLICY, {
      ...complexityDefaults(CONFIGURED_POLICY),
      require_special: false,
      special_char_set: "!@#",
    });

    expect(payload.special_char_set).toBe("");
  });

  it("coerces numeric inputs, which arrive from the DOM as strings", () => {
    const payload = buildPolicyPayload(CONFIGURED_POLICY, {
      ...complexityDefaults(CONFIGURED_POLICY),
      min_length: "12" as unknown as number,
      max_length: "40" as unknown as number,
    });

    expect(payload.min_length).toBe(12);
    expect(payload.max_length).toBe(40);
  });
});
