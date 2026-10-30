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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

import CheckAuthNetwork from "./CheckAuthNetwork.vue";
import { mockMonitorHttp } from "@/test/unit/mockData/synthetics";

// ── Stubs ───────────────────────────────────────────────────────────────────

const OSwitchStub = {
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template: `<div :data-test="$attrs['data-test']">
    <input type="checkbox" :checked="modelValue" @click="$emit('update:modelValue', !modelValue)" />
    <span>{{ $attrs.label }}</span>
  </div>`,
};

const OInputStub = {
  props: ["modelValue", "type"],
  emits: ["update:modelValue"],
  template: `<input v-bind="$attrs" :value="modelValue" :type="type || 'text'" @input="$emit('update:modelValue', $event.target.value)" />`,
};

const OButtonStub = {
  props: ["iconLeft", "iconOnly", "variant", "size", "ariaLabel"],
  emits: ["click"],
  template: `<button v-bind="$attrs" @click="$emit('click')" :aria-label="ariaLabel"><slot /></button>`,
};

const OBadgeStub = {
  props: ["variant", "size"],
  template: '<span v-bind="$attrs"><slot /></span>',
};

const OIconStub = {
  props: ["name", "size"],
  template: '<i v-bind="$attrs" />',
};

const OSeparatorStub = {
  template: "<hr />",
};

const OTooltipStub = {
  props: ["content", "side"],
  template: "<span />",
};

const STUBS = {
  OInput: OInputStub,
  OSwitch: OSwitchStub,
  OButton: OButtonStub,
  OBadge: OBadgeStub,
  OIcon: OIconStub,
  OSeparator: OSeparatorStub,
  OTooltip: OTooltipStub,
};

// ── Mount factory ────────────────────────────────────────────────────────────

function mountCheckAuthNetwork(props: Record<string, unknown> = {}) {
  return mount(CheckAuthNetwork, {
    props: { check: mockMonitorHttp, ...props },
    global: { stubs: STUBS },
  }) as VueWrapper;
}

describe("CheckAuthNetwork", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    beforeEach(() => {
      wrapper = mountCheckAuthNetwork();
    });

    it("should render the component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the section title", () => {
      expect(wrapper.text()).toContain("synthetics.authNetwork.title");
    });

    it("should render the optional badge", () => {
      expect(wrapper.text()).toContain("synthetics.authNetwork.optional");
    });

    it("should render the basic auth switch", () => {
      const authSwitch = wrapper.find(
        '[data-test="synthetics-check-auth-network-basic-auth-switch"]',
      );
      expect(authSwitch.exists()).toBe(true);
    });

    it("should not render username/password inputs when auth is disabled", () => {
      expect(
        wrapper.find('[data-test="synthetics-check-auth-network-username-input"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="synthetics-check-auth-network-password-input"]').exists(),
      ).toBe(false);
    });
  });

  describe("auth toggle", () => {
    it("should show username and password inputs when auth is enabled", async () => {
      const checkNoAuth = { ...mockMonitorHttp, auth: undefined };
      wrapper = mountCheckAuthNetwork({ check: checkNoAuth });

      expect(
        wrapper.find('[data-test="synthetics-check-auth-network-username-input"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="synthetics-check-auth-network-password-input"]').exists(),
      ).toBe(false);

      const authSwitch = wrapper.find(
        '[data-test="synthetics-check-auth-network-basic-auth-switch"]',
      );
      const checkbox = authSwitch.find("input");
      await checkbox.trigger("click");
      await flushPromises();

      // The component emits update:check; simulate parent updating the prop
      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const updatedCheck = emitted![emitted!.length - 1][0] as any;
      await wrapper.setProps({ check: updatedCheck });

      expect(
        wrapper.find('[data-test="synthetics-check-auth-network-username-input"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-auth-network-password-input"]').exists(),
      ).toBe(true);
    });

    it("should hide username and password inputs when auth is disabled", async () => {
      const checkWithAuth = {
        ...mockMonitorHttp,
        auth: { type: "basic" as const, username: "admin", password: "secret" },
      };
      wrapper = mountCheckAuthNetwork({ check: checkWithAuth });

      expect(
        wrapper.find('[data-test="synthetics-check-auth-network-username-input"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="synthetics-check-auth-network-password-input"]').exists(),
      ).toBe(true);

      const authSwitch = wrapper.find(
        '[data-test="synthetics-check-auth-network-basic-auth-switch"]',
      );
      const checkbox = authSwitch.find("input");
      await checkbox.trigger("click");
      await flushPromises();

      // The component emits update:check; simulate parent updating the prop
      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const updatedCheck = emitted![emitted!.length - 1][0] as any;
      await wrapper.setProps({ check: updatedCheck });

      expect(
        wrapper.find('[data-test="synthetics-check-auth-network-username-input"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="synthetics-check-auth-network-password-input"]').exists(),
      ).toBe(false);
    });

    it("should emit update:check with basic auth when toggled on", async () => {
      const checkNoAuth = { ...mockMonitorHttp, auth: undefined };
      wrapper = mountCheckAuthNetwork({ check: checkNoAuth });

      const authSwitch = wrapper.find(
        '[data-test="synthetics-check-auth-network-basic-auth-switch"]',
      );
      const checkbox = authSwitch.find("input");
      await checkbox.trigger("click");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const last = emitted![emitted!.length - 1][0] as any;
      expect(last.auth).toBeDefined();
      expect(last.auth.type).toBe("basic");
      expect(last.auth.username).toBe("");
      expect(last.auth.password).toBe("");
    });

    it("should emit update:check with auth set to undefined when toggled off", async () => {
      const checkWithAuth = {
        ...mockMonitorHttp,
        auth: { type: "basic" as const, username: "admin", password: "secret" },
      };
      wrapper = mountCheckAuthNetwork({ check: checkWithAuth });

      const authSwitch = wrapper.find(
        '[data-test="synthetics-check-auth-network-basic-auth-switch"]',
      );
      const checkbox = authSwitch.find("input");
      await checkbox.trigger("click");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const last = emitted![emitted!.length - 1][0] as any;
      expect(last.auth).toBeUndefined();
    });

    it("should emit update:check with updated username", async () => {
      const checkWithAuth = {
        ...mockMonitorHttp,
        auth: { type: "basic" as const, username: "admin", password: "secret" },
      };
      wrapper = mountCheckAuthNetwork({ check: checkWithAuth });

      const usernameInput = wrapper.find(
        '[data-test="synthetics-check-auth-network-username-input"]',
      );
      await usernameInput.setValue("newuser");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const last = emitted![emitted!.length - 1][0] as any;
      expect(last.auth.username).toBe("newuser");
    });

    it("should emit update:check with updated password", async () => {
      const checkWithAuth = {
        ...mockMonitorHttp,
        auth: { type: "basic" as const, username: "admin", password: "secret" },
      };
      wrapper = mountCheckAuthNetwork({ check: checkWithAuth });

      const passwordInput = wrapper.find(
        '[data-test="synthetics-check-auth-network-password-input"]',
      );
      await passwordInput.setValue("newpass");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const last = emitted![emitted!.length - 1][0] as any;
      expect(last.auth.password).toBe("newpass");
    });
  });

  // Variables moved to CheckVariablesPanel — the header summary is basic-auth only.
  describe("header summary", () => {
    it("should show the basic auth summary when auth is set", () => {
      const checkWithAuth = {
        ...mockMonitorHttp,
        auth: { type: "basic" as const, username: "admin", password: "secret" },
      };
      wrapper = mountCheckAuthNetwork({ check: checkWithAuth });

      const summary = wrapper.find("span.text-text-muted.text-xs");
      expect(summary.exists()).toBe(true);
      expect(summary.text()).toContain("synthetics.authNetwork.httpBasicAuth");
    });

    it("should not render the summary span when auth is unset", () => {
      const checkNoAuth = { ...mockMonitorHttp, auth: undefined };
      wrapper = mountCheckAuthNetwork({ check: checkNoAuth });

      expect(wrapper.find("span.text-text-muted.text-xs").exists()).toBe(false);
    });
  });

  describe("no auth state", () => {
    it("should not show username or password when check has no auth", () => {
      const checkNoAuth = { ...mockMonitorHttp, auth: undefined };
      wrapper = mountCheckAuthNetwork({ check: checkNoAuth });

      expect(
        wrapper.find('[data-test="synthetics-check-auth-network-username-input"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="synthetics-check-auth-network-password-input"]').exists(),
      ).toBe(false);
    });
  });
});
