// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

import CheckTcpConfig from "./CheckTcpConfig.vue";
import { mockProtocolCheckTcp } from "@/test/unit/mockData/synthetics";

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

const STUBS = { OInput: OInputStub };

describe("CheckTcpConfig", () => {
  let wrapper: VueWrapper;

  function mountTcp(props: Record<string, unknown> = {}) {
    return mount(CheckTcpConfig, {
      props: { check: mockProtocolCheckTcp, ...props },
      global: { stubs: STUBS },
    });
  }

  beforeEach(() => {
    wrapper = mountTcp();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should render port input with correct value", () => {
      const portInput = wrapper.find('[data-test="synthetics-check-tcp-port-input"]');
      expect(portInput.exists()).toBe(true);
      expect((portInput.element as HTMLInputElement).value).toBe("5432");
    });

    it("should render timeout input with correct value", () => {
      const timeoutInput = wrapper.find('[data-test="synthetics-check-tcp-timeout-input"]');
      expect(timeoutInput.exists()).toBe(true);
      expect((timeoutInput.element as HTMLInputElement).value).toBe("10000");
    });

    it("should render response contains input with correct value", () => {
      const responseInput = wrapper.find(
        '[data-test="synthetics-check-tcp-response-contains-input"]',
      );
      expect(responseInput.exists()).toBe(true);
      expect((responseInput.element as HTMLInputElement).value).toBe("ready");
    });
  });

  describe("port change", () => {
    it("should emit update:check with new port when port input changes", async () => {
      const portInput = wrapper.find('[data-test="synthetics-check-tcp-port-input"]');
      await portInput.setValue("8080");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as any;
      expect(lastEmit.tcp.port).toBe(8080);
    });
  });

  describe("timeout change", () => {
    it("should emit update:check with new timeout_ms when timeout input changes", async () => {
      const timeoutInput = wrapper.find('[data-test="synthetics-check-tcp-timeout-input"]');
      await timeoutInput.setValue("5000");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as any;
      expect(lastEmit.tcp.timeout_ms).toBe(5000);
    });
  });

  describe("response contains change", () => {
    it("should emit update:check with new response_contains when input changes", async () => {
      const responseInput = wrapper.find(
        '[data-test="synthetics-check-tcp-response-contains-input"]',
      );
      await responseInput.setValue("connected");
      await flushPromises();

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as any;
      expect(lastEmit.tcp.response_contains).toBe("connected");
    });
  });
});
