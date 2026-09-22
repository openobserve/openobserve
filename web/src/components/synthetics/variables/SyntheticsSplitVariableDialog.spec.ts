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

import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { shallowMount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import type { SyntheticsEnvironment, SyntheticsVariable } from "@/types/synthetics";

const splitGlobalVariable = vi.fn().mockResolvedValue({});
vi.mock("@/services/synthetics", () => ({
  default: { splitGlobalVariable: (...a: unknown[]) => splitGlobalVariable(...a) },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import SyntheticsSplitVariableDialog from "./SyntheticsSplitVariableDialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";

const variable: SyntheticsVariable = {
  id: "g1",
  name: "BASE_URL",
  kind: "plain",
  value: "https://example.com",
  has_value: true,
  description: "",
  example: "",
  tags: [],
  used_by_checks: 2,
  used_by: ["Homepage", "Checkout"],
  created_at: 0,
  updated_at: 0,
};

const env = (name: string): SyntheticsEnvironment => ({
  id: `acme/${name}`,
  name,
  description: "",
  is_global: false,
  created_at: 0,
  updated_at: 0,
  checks_count: 0,
  variables: [],
});

async function mountDialog(over: Partial<SyntheticsVariable> = {}) {
  const wrapper = shallowMount(SyntheticsSplitVariableDialog, {
    props: {
      open: false,
      variable: { ...variable, ...over },
      environments: [env("staging"), env("prod")],
    },
    global: {
      plugins: [i18n],
      provide: { store: { state: { selectedOrganization: { identifier: "acme" } } } },
      stubs: {
        ODialog: { template: "<div><slot /><slot name='footer' /></div>" },
        OBanner: { template: "<div><slot /></div>" },
      },
    },
  }) as VueWrapper;
  await wrapper.setProps({ open: true });
  await nextTick();
  return wrapper;
}

const confirmButton = (wrapper: VueWrapper) =>
  wrapper
    .findAllComponents(OButton)
    .find((b) => b.attributes("data-test") === "synthetics-split-confirm-btn")!;

describe("SyntheticsSplitVariableDialog", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("prefills every environment with the global value", async () => {
    wrapper = await mountDialog();
    const values = wrapper.findAllComponents(OInput).map((input) => input.props("modelValue"));

    expect(values).toEqual(["https://example.com", "https://example.com"]);
    expect(confirmButton(wrapper).props("disabled")).toBe(false);
  });

  it("keeps confirm off while a ticked environment has no value", async () => {
    wrapper = await mountDialog({ value: "" });

    expect(confirmButton(wrapper).props("disabled")).toBe(true);

    for (const input of wrapper.findAllComponents(OInput)) {
      input.vm.$emit("update:modelValue", "https://filled.test");
    }
    await nextTick();
    expect(confirmButton(wrapper).props("disabled")).toBe(false);
  });

  it("names the checks that use the variable before the split is confirmed", async () => {
    wrapper = await mountDialog();
    const banner = wrapper.find('[data-test="synthetics-split-used-by"]');

    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("Homepage, Checkout");
    expect(banner.text()).toContain("2");
  });

  it("shows no usage note for an unused variable", async () => {
    wrapper = await mountDialog({ used_by: [], used_by_checks: 0 });

    expect(wrapper.find('[data-test="synthetics-split-used-by"]').exists()).toBe(false);
  });
});
