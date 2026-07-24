// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";

import i18n from "@/locales";
import { mockMonitorBrowser } from "@/test/unit/mockData/synthetics";
import CheckRUM from "./CheckRUM.vue";

const OSwitchStub = {
  props: ["modelValue", "label", "disabled"],
  emits: ["update:modelValue"],
  methods: {
    handleChange(e: Event) {
      this.$emit("update:modelValue", (e.target as HTMLInputElement).checked);
    },
  },
  template: `<label :data-test="$attrs['data-test']">
    <input type="checkbox" :checked="modelValue" :disabled="disabled" @change="handleChange" />
    {{ label }}
  </label>`,
};

describe("CheckRUM", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  function mountRUM(check = mockMonitorBrowser) {
    return mount(CheckRUM, {
      props: { check },
      global: { plugins: [i18n], stubs: { OSwitch: OSwitchStub } },
    });
  }

  describe("initial render", () => {
    beforeEach(() => {
      wrapper = mountRUM();
    });

    it("should render the component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the collect RUM switch", () => {
      const collectSwitch = wrapper.find('[data-test="synthetics-check-rum-collect-switch"]');
      expect(collectSwitch.exists()).toBe(true);
    });

    it("should render the session replay switch", () => {
      const replaySwitch = wrapper.find('[data-test="synthetics-check-rum-session-replay-switch"]');
      expect(replaySwitch.exists()).toBe(true);
    });
  });

  describe("collect RUM switch reflects check.rum.collect", () => {
    it("should have collect RUM checked when rum.collect is true", () => {
      const check = { ...mockMonitorBrowser, rum: { collect: true, sessionReplay: true } };
      wrapper = mountRUM(check);
      const input = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-rum-collect-switch"] input',
      );
      expect(input.element.checked).toBe(true);
    });

    it("should have collect RUM unchecked when rum.collect is false", () => {
      const check = { ...mockMonitorBrowser, rum: { collect: false, sessionReplay: false } };
      wrapper = mountRUM(check);
      const input = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-rum-collect-switch"] input',
      );
      expect(input.element.checked).toBe(false);
    });
  });

  describe("session replay switch reflects check.rum.sessionReplay", () => {
    it("should have session replay checked when sessionReplay is true and collect is true", () => {
      const check = { ...mockMonitorBrowser, rum: { collect: true, sessionReplay: true } };
      wrapper = mountRUM(check);
      const input = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-rum-session-replay-switch"] input',
      );
      expect(input.element.checked).toBe(true);
    });

    it("should have session replay unchecked when sessionReplay is false and collect is true", () => {
      const check = { ...mockMonitorBrowser, rum: { collect: true, sessionReplay: false } };
      wrapper = mountRUM(check);
      const input = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-rum-session-replay-switch"] input',
      );
      expect(input.element.checked).toBe(false);
    });
  });

  describe("session replay disabled state", () => {
    it("should disable session replay switch when collect RUM is off", () => {
      const check = { ...mockMonitorBrowser, rum: { collect: false, sessionReplay: false } };
      wrapper = mountRUM(check);
      const input = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-rum-session-replay-switch"] input',
      );
      expect(input.element.disabled).toBe(true);
    });

    it("should enable session replay switch when collect RUM is on", () => {
      const check = { ...mockMonitorBrowser, rum: { collect: true, sessionReplay: false } };
      wrapper = mountRUM(check);
      const input = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-rum-session-replay-switch"] input',
      );
      expect(input.element.disabled).toBe(false);
    });
  });

  describe("emit update:check on toggle", () => {
    it("should emit update:check when collect RUM is toggled on", async () => {
      const check = { ...mockMonitorBrowser, rum: { collect: false, sessionReplay: false } };
      wrapper = mountRUM(check);
      const input = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-rum-collect-switch"] input',
      );

      await input.setValue(true);

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].rum.collect).toBe(true);
      expect(emitted![0][0].rum.sessionReplay).toBe(false);
    });

    it("should emit update:check when collect RUM is toggled off", async () => {
      wrapper = mountRUM();
      const input = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-rum-collect-switch"] input',
      );

      await input.setValue(false);

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].rum.collect).toBe(false);
    });

    it("should emit update:check when session replay is toggled on", async () => {
      const check = { ...mockMonitorBrowser, rum: { collect: true, sessionReplay: false } };
      wrapper = mountRUM(check);
      const input = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-rum-session-replay-switch"] input',
      );

      await input.setValue(true);

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].rum.collect).toBe(true);
      expect(emitted![0][0].rum.sessionReplay).toBe(true);
    });

    it("should emit update:check when session replay is toggled off", async () => {
      wrapper = mountRUM();
      const input = wrapper.find<HTMLInputElement>(
        '[data-test="synthetics-check-rum-session-replay-switch"] input',
      );

      await input.setValue(false);

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].rum.sessionReplay).toBe(false);
    });
  });

  describe("conditional styling", () => {
    it("should apply opacity when collect RUM is off", () => {
      const check = { ...mockMonitorBrowser, rum: { collect: false, sessionReplay: false } };
      wrapper = mountRUM(check);
      // The session replay div should have opacity-50 class when collect is off
      const replayDiv = wrapper.find('[data-test="synthetics-check-rum-session-replay-switch"]')
        .element.parentElement;
      expect(replayDiv?.classList.contains("opacity-50")).toBe(true);
    });

    it("should not apply opacity when collect RUM is on", () => {
      wrapper = mountRUM();
      const replayDiv = wrapper.find('[data-test="synthetics-check-rum-session-replay-switch"]')
        .element.parentElement;
      expect(replayDiv?.classList.contains("opacity-50")).toBe(false);
    });
  });
});
