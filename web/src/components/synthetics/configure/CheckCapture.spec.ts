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
import { mockMonitorBrowser } from "@/test/unit/mockData/synthetics";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

import CheckCapture from "./CheckCapture.vue";

const OSelectStub = {
  props: ["modelValue", "options"],
  emits: ["update:modelValue"],
  methods: {
    handleChange(e: Event) {
      this.$emit("update:modelValue", (e.target as HTMLSelectElement).value);
    },
  },
  template: `<select :data-test="$attrs['data-test']" @change="handleChange">
    <option v-for="opt in options" :key="opt.value" :value="opt.value" :selected="opt.value === modelValue">{{ opt.label }}</option>
  </select>`,
};

describe("CheckCapture", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  function mountCapture(check = mockMonitorBrowser) {
    return mount(CheckCapture, {
      props: { check },
      global: { stubs: { OSelect: OSelectStub } },
    });
  }

  describe("initial render", () => {
    beforeEach(() => {
      wrapper = mountCapture();
    });

    it("should render the capture title", () => {
      expect(wrapper.text()).toContain("synthetics.capture.title");
    });

    it("should render the screenshot label", () => {
      expect(wrapper.text()).toContain("synthetics.capture.screenshot");
    });

    it("should render the screenshot select with data-test attribute", () => {
      const select = wrapper.find('[data-test="synthetics-check-capture-screenshot"]');
      expect(select.exists()).toBe(true);
    });

    it("should show the correct description for the current screenshot value", () => {
      // mockMonitorBrowser has capture.screenshot = 'on-fail'
      expect(wrapper.text()).toContain("synthetics.capture.screenshotDescriptionOnFail");
    });
  });

  describe("screenshot selection", () => {
    it("should emit update:check with updated screenshot when select changes to always", async () => {
      wrapper = mountCapture();
      const select = wrapper.find('[data-test="synthetics-check-capture-screenshot"]');
      expect(select.exists()).toBe(true);

      await select.setValue("always");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].capture.screenshot).toBe("always");
      // other capture properties should remain unchanged
      expect(emitted![0][0].capture.trace).toBe("on-fail");
    });

    it("should emit update:check with updated screenshot when select changes to off", async () => {
      wrapper = mountCapture();
      const select = wrapper.find('[data-test="synthetics-check-capture-screenshot"]');
      expect(select.exists()).toBe(true);

      await select.setValue("off");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].capture.screenshot).toBe("off");
    });

    it("should show the correct description after parent re-renders with always", async () => {
      wrapper = mountCapture();
      const select = wrapper.find('[data-test="synthetics-check-capture-screenshot"]');

      await select.setValue("always");

      // Verify the emit happened with the right value
      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].capture.screenshot).toBe("always");

      // Simulate parent re-render with new check prop
      await wrapper.setProps({ check: emitted![0][0] });
      await flushPromises();

      expect(wrapper.text()).toContain("synthetics.capture.screenshotDescriptionAlways");
    });

    it("should show the correct description after parent re-renders with off", async () => {
      wrapper = mountCapture();
      const select = wrapper.find('[data-test="synthetics-check-capture-screenshot"]');

      await select.setValue("off");

      const emitted = wrapper.emitted("update:check");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0].capture.screenshot).toBe("off");

      await wrapper.setProps({ check: emitted![0][0] });
      await flushPromises();

      expect(wrapper.text()).toContain("synthetics.capture.screenshotDescriptionOff");
    });
  });

  describe("initial render with different capture values", () => {
    it("should show always description when screenshot is always", () => {
      const check = {
        ...mockMonitorBrowser,
        capture: { ...mockMonitorBrowser.capture, screenshot: "always" as const },
      };
      wrapper = mountCapture(check);
      expect(wrapper.text()).toContain("synthetics.capture.screenshotDescriptionAlways");
    });

    it("should show off description when screenshot is off", () => {
      const check = {
        ...mockMonitorBrowser,
        capture: { ...mockMonitorBrowser.capture, screenshot: "off" as const },
      };
      wrapper = mountCapture(check);
      expect(wrapper.text()).toContain("synthetics.capture.screenshotDescriptionOff");
    });
  });
});
