// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

import CheckTlsConfig from "./CheckTlsConfig.vue";
import { mockTlsConfig } from "@/test/unit/mockData/synthetics";
import type { ProtocolCheck } from "@/types/synthetics";

const mockProtocolCheckTls: ProtocolCheck = {
  id: "proto-tls-1",
  name: "TLS Check",
  url: "tls://example.com",
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
  checkType: "tls",
  tls: mockTlsConfig,
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

const OSwitchStub = {
  inheritAttrs: false,
  props: ["modelValue", "label"],
  emits: ["update:modelValue"],
  template: `
    <label>{{ label }}</label>
    <input
      type="checkbox"
      :checked="modelValue"
      :data-test="$attrs['data-test']"
      @change="$emit('update:modelValue', $event.target.checked)"
    />
  `,
};

const STUBS = { OInput: OInputStub, OSwitch: OSwitchStub };

describe("CheckTlsConfig", () => {
  let wrapper: VueWrapper;

  function mountTls(props: Record<string, unknown> = {}) {
    return mount(CheckTlsConfig, {
      props: { check: mockProtocolCheckTls, ...props },
      global: { stubs: STUBS },
    });
  }

  beforeEach(() => {
    wrapper = mountTls();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should render port input with correct value", () => {
      const portInput = wrapper.find('[data-test="synthetics-check-tls-port-input"]');
      expect(portInput.exists()).toBe(true);
      expect((portInput.element as HTMLInputElement).value).toBe("443");
    });

    it("should render timeout input with correct value", () => {
      const timeoutInput = wrapper.find('[data-test="synthetics-check-tls-timeout-input"]');
      expect(timeoutInput.exists()).toBe(true);
      expect((timeoutInput.element as HTMLInputElement).value).toBe("10000");
    });

    it("should render min days input with correct value", () => {
      const minDaysInput = wrapper.find('[data-test="synthetics-check-tls-min-days-input"]');
      expect(minDaysInput.exists()).toBe(true);
      expect((minDaysInput.element as HTMLInputElement).value).toBe("30");
    });

    it("should render verify chain switch as checked", () => {
      const verifyChainSwitch = wrapper.find(
        '[data-test="synthetics-check-tls-verify-chain-switch"]',
      );
      expect(verifyChainSwitch.exists()).toBe(true);
      expect((verifyChainSwitch.element as HTMLInputElement).checked).toBe(true);
    });

    it("should render verify hostname switch as checked", () => {
      const verifyHostnameSwitch = wrapper.find(
        '[data-test="synthetics-check-tls-verify-hostname-switch"]',
      );
      expect(verifyHostnameSwitch.exists()).toBe(true);
      expect((verifyHostnameSwitch.element as HTMLInputElement).checked).toBe(true);
    });
  });

  describe("port change", () => {
    it("should emit update:check with new port when port input changes", async () => {
      const portInput = wrapper.find('[data-test="synthetics-check-tls-port-input"]');
      await portInput.setValue("8443");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as any;
      expect(lastEmit.tls.port).toBe(8443);
    });
  });

  describe("timeout change", () => {
    it("should emit update:check with new timeout_ms when timeout input changes", async () => {
      const timeoutInput = wrapper.find('[data-test="synthetics-check-tls-timeout-input"]');
      await timeoutInput.setValue("5000");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as any;
      expect(lastEmit.tls.timeout_ms).toBe(5000);
    });
  });

  describe("min days change", () => {
    it("should emit update:check with new min_days_until_expiry when input changes", async () => {
      const minDaysInput = wrapper.find('[data-test="synthetics-check-tls-min-days-input"]');
      await minDaysInput.setValue("60");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as any;
      expect(lastEmit.tls.min_days_until_expiry).toBe(60);
    });
  });

  describe("verify chain toggle", () => {
    it("should emit update:check with toggled verify_chain when switch is toggled", async () => {
      const verifyChainSwitch = wrapper.find(
        '[data-test="synthetics-check-tls-verify-chain-switch"]',
      );
      await verifyChainSwitch.setValue(false);
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as any;
      expect(lastEmit.tls.verify_chain).toBe(false);
      expect(lastEmit.tls.verify_hostname).toBe(true); // unchanged
    });
  });

  describe("verify hostname toggle", () => {
    it("should emit update:check with toggled verify_hostname when switch is toggled", async () => {
      const verifyHostnameSwitch = wrapper.find(
        '[data-test="synthetics-check-tls-verify-hostname-switch"]',
      );
      await verifyHostnameSwitch.setValue(false);
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as any;
      expect(lastEmit.tls.verify_hostname).toBe(false);
      expect(lastEmit.tls.verify_chain).toBe(true); // unchanged
    });
  });
});
