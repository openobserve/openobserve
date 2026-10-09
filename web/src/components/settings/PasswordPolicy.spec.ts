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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { Dialog, Notify } from "quasar";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import passwordPolicy, { type PasswordPolicy } from "@/services/passwordPolicy";
import PasswordPolicySettings from "./PasswordPolicy.vue";

installQuasar({ plugins: [Dialog, Notify] });

vi.mock("@/services/passwordPolicy", () => ({
  default: {
    getComplexity: vi.fn(),
    getPolicy: vi.fn(),
    updatePolicy: vi.fn(),
  },
}));

const t = i18n.global.t;

const POLICY: PasswordPolicy = {
  min_length: 15,
  max_length: 128,
  require_uppercase: true,
  require_lowercase: true,
  require_digit: true,
  require_special: true,
  special_char_set: "!@#$%^&*()",
  rotation_days: 0,
  rotation_warning_days: 7,
  history_count: 0,
  history_max_retained: 30,
  lockout: {
    threshold: 0,
    bucket_size: 0,
    start_secs: 60,
    max_secs: 3600,
    backoff: "exponential",
  },
  cookie_max_age_secs: 0,
  apply_to_root: false,
};

const mountWith = async (overrides: Partial<PasswordPolicy> = {}) => {
  vi.mocked(passwordPolicy.getPolicy).mockResolvedValue({
    data: { ...POLICY, ...overrides },
  } as any);
  const wrapper = mount(PasswordPolicySettings, {
    global: { plugins: [i18n, store] },
  });
  await flushPromises();
  return wrapper;
};

const section = (wrapper: VueWrapper, id: string) =>
  wrapper.find(`[data-test="settings-password-policy-section-${id}"]`);

const row = (wrapper: VueWrapper, id: string) =>
  wrapper.find(`[data-test="settings-password-policy-${id}"]`);

describe("PasswordPolicy layout", () => {
  it("renders each section's policies inside that section's grid", async () => {
    const wrapper = await mountWith();

    const expected: Record<string, number> = {
      complexity: 7,
      rotation: 2,
      reuse: 2,
      lockout: 5,
      session: 2,
    };
    for (const [id, count] of Object.entries(expected)) {
      const grid = section(wrapper, id);
      expect(grid.exists()).toBe(true);
      expect(grid.classes()).toContain("password-policy-grid");
      expect(grid.findAll(".password-policy-row")).toHaveLength(count);
    }
  });

  it("puts the description under the title, with the control beside them", async () => {
    const wrapper = await mountWith();
    const cell = row(wrapper, "min-length");

    const [text, control] = cell.element.children;
    expect(text.classList.contains("password-policy-text")).toBe(true);
    expect(text.children[0].textContent?.trim()).toBe(
      t("passwordPolicy.minLength"),
    );
    expect(text.children[1].textContent?.trim()).toBe(
      t("passwordPolicy.minLengthDesc"),
    );
    expect(control.querySelector("input")).not.toBeNull();
  });

  it("keeps a toggle inline with its title", async () => {
    const wrapper = await mountWith();
    const [text, control] = row(wrapper, "require-uppercase").element.children;

    expect(text.classList.contains("password-policy-text")).toBe(true);
    expect(control.classList.contains("q-toggle")).toBe(true);
  });

  it("renders a section's notes inside its grid", async () => {
    const wrapper = await mountWith();

    expect(
      section(wrapper, "reuse")
        .find('[data-test="settings-password-policy-reuse-explainer"]')
        .exists(),
    ).toBe(true);
  });
});

const pairOf = (wrapper: VueWrapper, id: string) =>
  row(wrapper, id).element.parentElement;

const isLastPair = (wrapper: VueWrapper, id: string) =>
  pairOf(wrapper, id)?.classList.contains("password-policy-pair--last");

const pairsIn = (wrapper: VueWrapper, id: string) =>
  section(wrapper, id).findAll(".password-policy-pair");

describe("PasswordPolicy rows", () => {
  it("groups the policies two to a row, in order", async () => {
    const wrapper = await mountWith();

    expect(pairsIn(wrapper, "complexity")).toHaveLength(4);
    expect(pairsIn(wrapper, "lockout")).toHaveLength(3);
    expect(pairOf(wrapper, "min-length")).toBe(pairOf(wrapper, "max-length"));
    expect(pairOf(wrapper, "require-digit")).toBe(
      pairOf(wrapper, "require-special"),
    );
    expect(pairOf(wrapper, "max-length")).not.toBe(
      pairOf(wrapper, "require-uppercase"),
    );
  });

  it("drops the border of a lone last policy's row only", async () => {
    const wrapper = await mountWith();

    expect(
      pairOf(wrapper, "special-char-set")?.querySelectorAll(
        ".password-policy-row",
      ),
    ).toHaveLength(1);
    expect(isLastPair(wrapper, "special-char-set")).toBe(true);
    expect(isLastPair(wrapper, "require-special")).toBe(false);
    expect(isLastPair(wrapper, "lockout-backoff")).toBe(true);
    expect(isLastPair(wrapper, "lockout-bucket-size")).toBe(false);
  });

  it("drops the border of a full last row", async () => {
    const wrapper = await mountWith({ require_special: false });

    expect(row(wrapper, "special-char-set").exists()).toBe(false);
    expect(pairsIn(wrapper, "complexity")).toHaveLength(3);
    expect(isLastPair(wrapper, "require-digit")).toBe(true);
    expect(isLastPair(wrapper, "require-lowercase")).toBe(false);
  });

  it("keeps every row border when the section shows a note", async () => {
    const wrapper = await mountWith();

    expect(isLastPair(wrapper, "history-count")).toBe(false);
  });

  it("follows the rotation preview note as rotation turns on", async () => {
    const off = await mountWith({ rotation_days: 0 });
    expect(isLastPair(off, "rotation-days")).toBe(true);

    const on = await mountWith({ rotation_days: 90 });
    expect(isLastPair(on, "rotation-days")).toBe(false);
  });

  it("re-flows the rows when require special is switched off", async () => {
    const wrapper = await mountWith();

    await row(wrapper, "require-special").find(".q-toggle").trigger("click");

    expect(row(wrapper, "special-char-set").exists()).toBe(false);
    expect(pairsIn(wrapper, "complexity")).toHaveLength(3);
    expect(isLastPair(wrapper, "require-special")).toBe(true);
  });
});

describe("PasswordPolicy sticky header and footer", () => {
  const body = (wrapper: VueWrapper) =>
    wrapper.find('[data-test="settings-password-policy-body"]');

  it("keeps the header out of the scrolling body", async () => {
    const wrapper = await mountWith();
    const header = wrapper.find(
      '[data-test="settings-password-policy-header"]',
    );

    expect(header.text()).toContain(t("settings.passwordPolicy"));
    expect(body(wrapper).classes()).toContain("tw:overflow-y-auto");
    expect(body(wrapper).element.contains(header.element)).toBe(false);
  });

  it("scrolls the policy sections inside the body", async () => {
    const wrapper = await mountWith();

    expect(
      body(wrapper)
        .find('[data-test="settings-password-policy-section-complexity"]')
        .exists(),
    ).toBe(true);
  });

  it("keeps Cancel and Save in a footer outside the body, inside the form", async () => {
    const wrapper = await mountWith();
    const footer = wrapper.find(
      '[data-test="settings-password-policy-footer"]',
    );

    for (const id of ["cancel", "save"]) {
      const button = footer.find(
        `[data-test="settings-password-policy-${id}-btn"]`,
      );
      expect(button.exists()).toBe(true);
      expect(body(wrapper).element.contains(button.element)).toBe(false);
    }
    expect(footer.element.closest("form")).not.toBeNull();
  });
});

describe("PasswordPolicy loading state", () => {
  it("centres the loader in the space under the header", async () => {
    vi.mocked(passwordPolicy.getPolicy).mockReturnValue(
      new Promise(() => {}) as any,
    );
    const wrapper = mount(PasswordPolicySettings, {
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    const loader = wrapper.find('[data-test="password-policy-loading"]');
    expect(loader.find(".q-spinner").exists()).toBe(true);
    expect(loader.classes()).toEqual(
      expect.arrayContaining([
        "tw:flex-1",
        "tw:flex",
        "tw:items-center",
        "tw:justify-center",
      ]),
    );
  });
});

describe("PasswordPolicy section notes", () => {
  it("drops the paragraph's bottom margin so the note sits on the section border", async () => {
    const wrapper = await mountWith({ rotation_days: 90 });

    for (const id of ["reuse-explainer", "rotation-preview"]) {
      expect(
        wrapper.find(`[data-test="settings-password-policy-${id}"]`).classes(),
      ).toContain("tw:mb-0!");
    }
  });
});
