// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

import CheckSshConfig from "./CheckSshConfig.vue";
import { mockSshConfig } from "@/test/unit/mockData/synthetics";
import type { ProtocolCheck } from "@/types/synthetics";

const mockProtocolCheckSsh: ProtocolCheck = {
  id: "proto-ssh-1",
  name: "SSH Check",
  url: "ssh://db.internal",
  enabled: true,
  tags: [],
  journey: [],
  schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
  locations: ["us-east-1"],
  browserDevices: [],
  retries: 1,
  waitBeforeRetrySecs: 5,
  alertIfFails: 2,
  cooldownMins: 10,
  notifications: { destinations: [] },
  rum: { collect: false, sessionReplay: false },
  capture: { screenshot: "off", trace: "off" },
  checkType: "ssh",
  ssh: mockSshConfig,
};

const OInputStub = {
  inheritAttrs: false,
  props: ["modelValue", "type", "label", "placeholder", "required", "rows"],
  emits: ["update:modelValue"],
  template: `
    <input
      v-if="type !== 'textarea'"
      :value="modelValue"
      :type="type || 'text'"
      :placeholder="placeholder"
      :required="required"
      :data-test="$attrs['data-test']"
      @input="$emit('update:modelValue', $event.target.value)"
    />
    <textarea
      v-else
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      :required="required"
      :data-test="$attrs['data-test']"
      @input="$emit('update:modelValue', $event.target.value)"
    />
  `,
};

const ORadioGroupStub = {
  props: ["modelValue", "label", "orientation"],
  emits: ["update:modelValue"],
  template: `
    <fieldset :data-test="$attrs['data-test']">
      <legend>{{ label }}</legend>
      <slot />
    </fieldset>
  `,
};

const ORadioStub = {
  props: ["value", "label"],
  template: `
    <label>
      <input
        type="radio"
        :value="value"
        :checked="false"
        :data-test="$attrs['data-test']"
      />
      {{ label }}
    </label>
  `,
};

const STUBS = { OInput: OInputStub, ORadioGroup: ORadioGroupStub, ORadio: ORadioStub };

describe("CheckSshConfig", () => {
  let wrapper: VueWrapper;

  function mountSsh(props: Record<string, unknown> = {}) {
    return mount(CheckSshConfig, {
      props: { check: mockProtocolCheckSsh, ...props },
      global: { stubs: STUBS },
    });
  }

  beforeEach(() => {
    wrapper = mountSsh();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render with private_key auth", () => {
    it("should render port input with correct value", () => {
      const portInput = wrapper.find('[data-test="synthetics-check-ssh-port-input"]');
      expect(portInput.exists()).toBe(true);
      expect((portInput.element as HTMLInputElement).value).toBe("22");
    });

    it("should render timeout input with correct value", () => {
      const timeoutInput = wrapper.find('[data-test="synthetics-check-ssh-timeout-input"]');
      expect(timeoutInput.exists()).toBe(true);
      expect((timeoutInput.element as HTMLInputElement).value).toBe("15000");
    });

    it("should render username input with correct value", () => {
      const usernameInput = wrapper.find('[data-test="synthetics-check-ssh-username-input"]');
      expect(usernameInput.exists()).toBe(true);
      expect((usernameInput.element as HTMLInputElement).value).toBe("deploy");
    });

    it("should render auth type radio group", () => {
      const radioGroup = wrapper.find('[data-test="synthetics-check-ssh-auth-type-radio"]');
      expect(radioGroup.exists()).toBe(true);
    });

    it("should render secret as textarea when auth type is private_key", () => {
      const secretInput = wrapper.find('[data-test="synthetics-check-ssh-secret-input"]');
      expect(secretInput.exists()).toBe(true);
      // textarea type means <textarea> element, not <input>
      expect(secretInput.element.tagName).toBe("TEXTAREA");
    });
  });

  describe("auth type password", () => {
    it("should render secret as password input when auth type is password", async () => {
      const passwordCheck: ProtocolCheck = {
        ...mockProtocolCheckSsh,
        ssh: { ...mockSshConfig, authType: "password" as const, secret: "mypassword" },
      };
      await wrapper.setProps({ check: passwordCheck });

      const secretInput = wrapper.find('[data-test="synthetics-check-ssh-secret-input"]');
      expect(secretInput.exists()).toBe(true);
      // password type means <input> element, not <textarea>
      expect(secretInput.element.tagName).toBe("INPUT");
    });
  });

  describe("port change", () => {
    it("should emit update:check with new port when port input changes", async () => {
      const portInput = wrapper.find('[data-test="synthetics-check-ssh-port-input"]');
      await portInput.setValue("2222");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as any;
      expect(lastEmit.ssh.port).toBe(2222);
    });
  });

  describe("username change", () => {
    it("should emit update:check with new username when input changes", async () => {
      const usernameInput = wrapper.find('[data-test="synthetics-check-ssh-username-input"]');
      await usernameInput.setValue("admin");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as any;
      expect(lastEmit.ssh.username).toBe("admin");
    });
  });

  describe("secret change", () => {
    it("should emit update:check with new secret when secret input changes", async () => {
      const secretInput = wrapper.find('[data-test="synthetics-check-ssh-secret-input"]');
      await secretInput.setValue("new-secret-key");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as any;
      expect(lastEmit.ssh.secret).toBe("new-secret-key");
    });
  });

  describe("timeout change", () => {
    it("should emit update:check with new timeout_ms when timeout input changes", async () => {
      const timeoutInput = wrapper.find('[data-test="synthetics-check-ssh-timeout-input"]');
      await timeoutInput.setValue("30000");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as any;
      expect(lastEmit.ssh.timeout_ms).toBe(30000);
    });
  });
});
