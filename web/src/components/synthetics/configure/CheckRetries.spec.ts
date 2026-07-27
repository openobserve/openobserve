// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import type { BrowserCheck } from "@/types/synthetics";
import { mockMonitorHttp } from "@/test/unit/mockData/synthetics";

// ── Stubs ────────────────────────────────────────────────────────────────────

const OInputStub = {
  props: ["modelValue", "type", "placeholder", "class"],
  emits: ["update:modelValue"],
  template: `<input v-bind="$attrs" :value="modelValue" :type="type" @input="$emit('update:modelValue', $event.target.value)" />`,
};

const STUBS = {
  OInput: OInputStub,
};

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

// ── SUT import (after mocks) ────────────────────────────────────────────────

import CheckRetries from "./CheckRetries.vue";

// ── Mount factory ────────────────────────────────────────────────────────────

function mountCheckRetries(
  checkOverrides: Partial<BrowserCheck> = {},
  validationErrors?: Record<string, string>,
) {
  const check = { ...mockMonitorHttp, ...checkOverrides } as BrowserCheck;
  return mount(CheckRetries, {
    props: { check, validationErrors },
    global: {
      stubs: STUBS,
    },
  }) as VueWrapper;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CheckRetries", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("renders the retries section heading using i18n key", () => {
      wrapper = mountCheckRetries(mockMonitorHttp);

      expect(wrapper.find("h3").text()).toBe("synthetics.scheduleAlert.retries");
    });

    it("renders the retries input with value from check.retries", () => {
      wrapper = mountCheckRetries({ retries: 3 });

      const input = wrapper.find('[data-test="synthetics-check-retries-count-input"]');
      expect(input.exists()).toBe(true);
      expect(input.attributes("value")).toBe("3");
    });

    it("renders the retry delay input with value from check.waitBeforeRetrySecs", () => {
      wrapper = mountCheckRetries({ waitBeforeRetrySecs: 15 });

      const input = wrapper.find('[data-test="synthetics-check-retries-delay-input"]');
      expect(input.exists()).toBe(true);
      expect(input.attributes("value")).toBe("15");
    });

    it("renders default values (0) when check fields are undefined", () => {
      wrapper = mountCheckRetries({
        retries: undefined,
        waitBeforeRetrySecs: undefined,
      } as Partial<BrowserCheck> as any);

      const retriesInput = wrapper.find('[data-test="synthetics-check-retries-count-input"]');
      const delayInput = wrapper.find('[data-test="synthetics-check-retries-delay-input"]');

      expect(retriesInput.attributes("value")).toBe("0");
      expect(delayInput.attributes("value")).toBe("0");
    });

    it("does not render the validation error element when validationErrors.retries is not set", () => {
      wrapper = mountCheckRetries(mockMonitorHttp);

      const error = wrapper.find('[data-test="synthetics-check-retries-error"]');
      expect(error.exists()).toBe(false);
    });
  });

  describe("retries input", () => {
    it("emits update:check with updated retries when retries input changes", async () => {
      wrapper = mountCheckRetries({ retries: 2 });

      const input = wrapper.find('[data-test="synthetics-check-retries-count-input"]');
      await input.setValue("5");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as BrowserCheck;
      expect(lastEmit.retries).toBe(5);
    });
  });

  describe("retry delay input", () => {
    it("emits update:check with updated waitBeforeRetrySecs when delay input changes", async () => {
      wrapper = mountCheckRetries({ waitBeforeRetrySecs: 10 });

      const input = wrapper.find('[data-test="synthetics-check-retries-delay-input"]');
      await input.setValue("30");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0] as BrowserCheck;
      expect(lastEmit.waitBeforeRetrySecs).toBe(30);
    });
  });

  describe("validation error", () => {
    it("shows the validation error message when validationErrors.retries is set", () => {
      wrapper = mountCheckRetries(mockMonitorHttp, {
        retries: "Retries must be between 0 and 10",
      });

      const error = wrapper.find('[data-test="synthetics-check-retries-error"]');
      expect(error.exists()).toBe(true);
      expect(error.text()).toBe("Retries must be between 0 and 10");
    });
  });
});
