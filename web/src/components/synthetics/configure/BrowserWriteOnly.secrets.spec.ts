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

import { describe, expect, it, vi } from "vitest";
import { computed, defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { BrowserCheck, BrowserStep } from "@/types/synthetics";
import CheckAuthNetwork from "./CheckAuthNetwork.vue";
import BrowserJourneyStepEditor from "@/components/synthetics/journey/BrowserJourneyStepEditor.vue";
import { isKept, slotKey } from "@/utils/synthetics/writeOnly";

vi.mock("@/views/Secrets/useSecretConsumer", () => ({
  useSecretPickerShown: () => computed(() => true),
}));
vi.mock("@/services/synthetics", () => ({
  default: {
    listByFolderId: vi.fn().mockResolvedValue({ data: { checks: [] } }),
    get: vi.fn(),
    getRuns: vi.fn(),
  },
}));

// The picker's own behaviour is covered by SecretPicker.spec; here it only has to emit a pick.
const SecretPickerStub = defineComponent({
  props: { dataTest: { type: String, default: "" } },
  emits: ["pick"],
  template: `<button :data-test="dataTest" @click="$emit('pick', { kind: 'secret', name: 'LOGIN_PASSWORD' })" />`,
});

const META = { updated_at: Date.now() * 1000, updated_by: "marco@acme.io" };
const sel = (name: string) => `[data-test="${name}"]`;

const browserCheck = (over: Partial<BrowserCheck> = {}): BrowserCheck =>
  ({
    name: "login-flow",
    url: "https://shop.acme.io/login",
    writeOnly: {
      [slotKey.browserSecret("ADMIN_OTP_SEED")]: META,
      [slotKey.cookie("csrf", "shop.acme.io")]: META,
    },
    secrets: [{ name: "ADMIN_OTP_SEED", value: "" }],
    cookies: [
      { name: "session", value: "{{secrets.SESSION_COOKIE}}", domain: "shop.acme.io" },
      { name: "csrf", value: "", domain: "shop.acme.io" },
    ],
    ...over,
  }) as BrowserCheck;

const mountAuth = (check: BrowserCheck) =>
  mount(CheckAuthNetwork, {
    props: { check },
    global: { plugins: [i18n, store], stubs: { SecretPicker: SecretPickerStub } },
  });

const lastCheck = (w: ReturnType<typeof mountAuth>) =>
  w.emitted("update:check")!.at(-1)![0] as BrowserCheck;

describe("browser check write-only rows (U5b)", () => {
  it("shows a kept browser secret and cookie as Set by who, with no value", () => {
    const w = mountAuth(browserCheck());
    const secret = w.find(sel("synthetics-check-auth-network-browser-secret-0-kept"));
    expect(secret.text()).toMatch(/^Set · updated .+ by marco@acme\.io/);
    const cookie = w.find(sel("synthetics-check-auth-network-cookie-value-1-kept"));
    expect(cookie.text()).toContain("Replace");
    expect(w.find(sel("synthetics-check-auth-network-cookie-value-0-kept")).exists()).toBe(false);
  });

  it("Replace on a kept browser secret drops the keep and leaves an empty value", async () => {
    const w = mountAuth(browserCheck());
    await w.find(sel("synthetics-check-auth-network-browser-secret-0-replace")).trigger("click");
    const next = lastCheck(w);
    expect(isKept(next, slotKey.browserSecret("ADMIN_OTP_SEED"))).toBe(false);
    expect(next.secrets![0].value).toBe("");
  });

  it("forces Secure on a cookie that holds a secret", () => {
    const w = mountAuth(browserCheck());
    const withRef = w
      .findAllComponents({ name: "OSwitch" })
      .find((c) => c.attributes("data-test") === "synthetics-check-auth-network-cookie-secure-0")!;
    expect(withRef.props("modelValue")).toBe(true);
    expect(withRef.props("disabled")).toBe(true);
    expect(w.text()).toContain("Always on for a cookie with a secret");
  });

  it("offers the picker on the auth password, and a pick replaces the kept password", async () => {
    const w = mountAuth(
      browserCheck({
        auth: { type: "basic", username: "probe-bot", password: "" },
        writeOnly: { [slotKey.authPassword()]: META },
        replacedSlots: [slotKey.authPassword()],
      }),
    );
    const picker = w.find(sel("synthetics-check-auth-network-password-secret-picker"));
    expect(picker.exists()).toBe(true);
    await picker.trigger("click");
    const next = lastCheck(w);
    expect(next.auth!.password).toBe("{{secrets.LOGIN_PASSWORD}}");
    expect(isKept(next, slotKey.authPassword())).toBe(false);
  });
});

describe("browser step values (U5b, D269)", () => {
  const renderStep = (step: Partial<BrowserStep>) =>
    mount(BrowserJourneyStepEditor, {
      props: {
        step: { id: "s1", action: "type", locator: { candidates: [] }, ...step } as BrowserStep,
      },
      global: { plugins: [i18n, store] },
    });

  it("shows a kept step value as Set by who, and Replace opens the value field", async () => {
    const w = renderStep({ value: "", valueSet: META });
    expect(w.find(sel("synthetics-journey-step-value-kept")).text()).toContain("marco@acme.io");
    expect(w.find(sel("synthetics-journey-step-value-input")).exists()).toBe(false);
    await w.find(sel("synthetics-journey-step-value-replace")).trigger("click");
    const next = w.emitted("update:step")!.at(-1)![0] as BrowserStep;
    expect(next.valueReplaced).toBe(true);
    expect(next.value).toBe("");
  });

  it("a replaced step value shows the field and Cancel restores the keep", async () => {
    const w = renderStep({ value: "", valueSet: META, valueReplaced: true });
    expect(w.find(sel("synthetics-journey-step-value-input")).exists()).toBe(true);
    await w.find(sel("synthetics-journey-step-value-cancel")).trigger("click");
    const next = w.emitted("update:step")!.at(-1)![0] as BrowserStep;
    expect(next.valueReplaced).toBe(false);
  });
});
