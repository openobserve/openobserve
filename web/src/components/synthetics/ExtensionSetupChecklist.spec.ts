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

// Stubs emit native-component click so parent @click handlers fire.
const OButtonStub = {
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
};
// Surfaces the bound model as a checkbox so the v-model round-trip is testable.
const OSwitchStub = {
  props: ["modelValue", "label"],
  emits: ["update:modelValue"],
  template:
    '<input type="checkbox" v-bind="$attrs" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
};

const STUBS = {
  OButton: OButtonStub,
  OSwitch: OSwitchStub,
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

  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

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
    delete store.state.zoConfig.synthetics_recorder_extension_url;
  });

  it("should emit update:incognitoDone when the incognito switch is toggled on", async () => {
    wrapper = mountChecklist();

    await wrapper.find('[data-test="synthetics-setup-incognito-switch"]').setValue(true);

    expect(wrapper.emitted("update:incognitoDone")).toEqual([[true]]);
  });

  it("should emit update:incognitoDone false when the switch is toggled back off", async () => {
    wrapper = mountChecklist({ incognitoDone: true });

    await wrapper.find('[data-test="synthetics-setup-incognito-switch"]').setValue(false);

    expect(wrapper.emitted("update:incognitoDone")).toEqual([[false]]);
  });

  it("should reflect the incognitoDone model on the switch", () => {
    wrapper = mountChecklist({ incognitoDone: true });

    const el = wrapper.find('[data-test="synthetics-setup-incognito-switch"]')
      .element as HTMLInputElement;
    expect(el.checked).toBe(true);
  });

  it("should show the connected line when the extension is connected", () => {
    wrapper = mountChecklist({ connected: true });

    expect(wrapper.text()).toContain("synthetics.createBrowserTest.setupConnected");
  });

  it("should not show the connected line when the extension is not connected", () => {
    wrapper = mountChecklist({ connected: false });

    expect(wrapper.text()).not.toContain("synthetics.createBrowserTest.setupConnected");
  });

  it("should not show the connected line when connected is omitted", () => {
    wrapper = mountChecklist();

    expect(wrapper.text()).not.toContain("synthetics.createBrowserTest.setupConnected");
  });
});
