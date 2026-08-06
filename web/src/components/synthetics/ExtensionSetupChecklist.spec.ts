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
import { mount, VueWrapper } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { CHROME_WEB_STORE_URL } from "@/constants/synthetics";
import store from "@/test/unit/helpers/store";
import ExtensionSetupChecklist from "./ExtensionSetupChecklist.vue";

// Forwards disabled and re-emits click so parent @click handlers fire.
const OButtonStub = {
  props: ["disabled"],
  emits: ["click"],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
};

// Surfaces the bound model as a native checkbox so the ack round-trips are testable.
const OCheckboxStub = {
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template:
    '<input type="checkbox" v-bind="$attrs" :checked="modelValue === true" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
};

// i18n-t interpolates Chrome UI labels into its slots; the raw keypath is
// enough for text assertions here.
const I18nTStub = {
  props: ["keypath"],
  template: "<span>{{ keypath }}</span>",
};

const STUBS = {
  OButton: OButtonStub,
  OCheckbox: OCheckboxStub,
  OIcon: true,
  "i18n-t": I18nTStub,
};

function mountChecklist(props: Record<string, unknown> = {}) {
  return mount(ExtensionSetupChecklist, {
    props,
    global: { plugins: [store], stubs: STUBS },
  }) as VueWrapper;
}

describe("ExtensionSetupChecklist", () => {
  let wrapper: VueWrapper;
  let openSpy: ReturnType<typeof vi.spyOn>;
  let reloadMock: ReturnType<typeof vi.fn>;
  const originalLocation = window.location;

  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    // jsdom's location.reload throws "Not implemented"; replaced wholesale, as
    // in http.spec.ts, because the property itself is read-only.
    reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, reload: reloadMock },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    // Cleaned up here (not inline in the test) so a failing assertion cannot
    // leak the config URL into later tests.
    delete store.state.zoConfig.synthetics_recorder_extension_url;
  });

  describe("task 1 — install", () => {
    it("should open the Chrome Web Store in a new tab from the install button", async () => {
      wrapper = mountChecklist();

      await wrapper.find('[data-test="synthetics-setup-install-btn"]').trigger("click");

      expect(openSpy).toHaveBeenCalledWith(CHROME_WEB_STORE_URL, "_blank", "noopener");
    });

    it("should prefer the /config extension URL over the built-in fallback", async () => {
      const configUrl = "https://chromewebstore.google.com/detail/custom-build";
      store.state.zoConfig.synthetics_recorder_extension_url = configUrl;
      wrapper = mountChecklist();

      await wrapper.find('[data-test="synthetics-setup-install-btn"]').trigger("click");

      expect(openSpy).toHaveBeenCalledWith(configUrl, "_blank", "noopener");
    });

    it("should emit update:installAck true when the install attestation is checked", async () => {
      wrapper = mountChecklist();

      await wrapper.find('[data-test="synthetics-setup-install-ack"]').setValue(true);

      expect(wrapper.emitted("update:installAck")).toEqual([[true]]);
    });

    it("should not emit true for a truthy non-boolean install ack value", async () => {
      wrapper = mountChecklist();

      // Task 2 is locked here, so the install ack is the only checkbox rendered.
      await wrapper.findComponent(OCheckboxStub).vm.$emit("update:modelValue", "indeterminate");

      const emitted = wrapper.emitted("update:installAck") ?? [];
      expect(emitted.flat()).not.toContain(true);
      // Still pending, so the attestation checkbox stays on screen.
      expect(wrapper.find('[data-test="synthetics-setup-install-ack"]').exists()).toBe(true);
    });

    it("should collapse to an auto-detected done row (no undo) once connected", () => {
      wrapper = mountChecklist({ connected: true });

      expect(wrapper.find('[data-test="synthetics-setup-install-btn"]').exists()).toBe(false);
      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupInstallDone");
      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupDetectedAuto");
      expect(wrapper.find('[data-test="synthetics-setup-install-undo"]').exists()).toBe(false);
    });

    it("should collapse to a done row with Undo when done via attestation alone", () => {
      wrapper = mountChecklist({ installAck: true });

      expect(wrapper.find('[data-test="synthetics-setup-install-btn"]').exists()).toBe(false);
      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupInstallDone");
      // The auto-detected marker is the probe's word, not the author's.
      expect(wrapper.text()).not.toContain("synthetics.createBrowserTest.setupDetectedAuto");
      expect(wrapper.find('[data-test="synthetics-setup-install-undo"]').exists()).toBe(true);
    });

    it("should emit update:installAck false when the install Undo is clicked", async () => {
      wrapper = mountChecklist({ installAck: true });

      await wrapper.find('[data-test="synthetics-setup-install-undo"]').trigger("click");

      expect(wrapper.emitted("update:installAck")).toEqual([[false]]);
    });
  });

  describe("task 2 — incognito attestation", () => {
    it("should render locked without a checkbox until the install task is done", () => {
      wrapper = mountChecklist();

      expect(wrapper.find('[data-test="synthetics-setup-incognito-ack"]').exists()).toBe(false);
      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupIncognitoTitle");
    });

    it("should unlock via the install attestation alone, without a connection", () => {
      wrapper = mountChecklist({ installAck: true });

      expect(wrapper.find('[data-test="synthetics-setup-incognito-ack"]').exists()).toBe(true);
    });

    it("should emit update:incognitoDone true when the ack checkbox is checked", async () => {
      wrapper = mountChecklist({ connected: true });

      await wrapper.find('[data-test="synthetics-setup-incognito-ack"]').setValue(true);

      expect(wrapper.emitted("update:incognitoDone")).toEqual([[true]]);
    });

    it("should not emit true for a truthy non-boolean incognito ack value", async () => {
      wrapper = mountChecklist({ connected: true });

      // Task 1 is collapsed here, so the incognito ack is the only checkbox rendered.
      await wrapper.findComponent(OCheckboxStub).vm.$emit("update:modelValue", "indeterminate");

      const emitted = wrapper.emitted("update:incognitoDone") ?? [];
      expect(emitted.flat()).not.toContain(true);
      expect(wrapper.find('[data-test="synthetics-setup-incognito-ack"]').exists()).toBe(true);
    });

    it("should collapse to a done row with an Undo action once acknowledged", () => {
      wrapper = mountChecklist({ connected: true, incognitoDone: true });

      expect(wrapper.find('[data-test="synthetics-setup-incognito-ack"]').exists()).toBe(false);
      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupIncognitoDoneTitle");
      expect(wrapper.find('[data-test="synthetics-setup-incognito-undo"]').exists()).toBe(true);
    });

    it("should emit update:incognitoDone false when Undo is clicked", async () => {
      wrapper = mountChecklist({ connected: true, incognitoDone: true });

      await wrapper.find('[data-test="synthetics-setup-incognito-undo"]').trigger("click");

      expect(wrapper.emitted("update:incognitoDone")).toEqual([[false]]);
    });
  });

  describe("task 3 — connect", () => {
    it("should show connect as done only on the real probe signal", () => {
      wrapper = mountChecklist({ connected: true, incognitoDone: true });

      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupConnectDone");
      expect(wrapper.find('[data-test="synthetics-setup-refresh-btn"]').exists()).toBe(false);
    });

    it("should become active when both attestations are done but the probe is silent", () => {
      wrapper = mountChecklist({ installAck: true, incognitoDone: true });

      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupConnectTitle");
      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupConnectAlt");
      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupConnectWaiting");
      expect(wrapper.text()).not.toContain("synthetics.createBrowserTest.setupConnectDone");
      expect(wrapper.find('[data-test="synthetics-setup-refresh-btn"]').exists()).toBe(true);
    });

    it("should reload the page from the refresh button", async () => {
      wrapper = mountChecklist({ installAck: true, incognitoDone: true });

      await wrapper.find('[data-test="synthetics-setup-refresh-btn"]').trigger("click");

      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it("should stay locked while the incognito ack is pending", () => {
      wrapper = mountChecklist({ connected: true, incognitoDone: false });

      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupConnectTitle");
      expect(wrapper.text()).not.toContain("synthetics.createBrowserTest.setupConnectDone");
      expect(wrapper.find('[data-test="synthetics-setup-refresh-btn"]').exists()).toBe(false);
    });

    it("should stay locked while nothing is done", () => {
      wrapper = mountChecklist();

      expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupConnectTitle");
      expect(wrapper.text()).not.toContain("synthetics.createBrowserTest.setupConnectDone");
      expect(wrapper.find('[data-test="synthetics-setup-refresh-btn"]').exists()).toBe(false);
    });
  });
});
