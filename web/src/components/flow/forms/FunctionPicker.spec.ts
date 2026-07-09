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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import FunctionPicker from "./FunctionPicker.vue";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const mockList = vi.fn();
vi.mock("@/services/jstransform", () => ({
  default: { list: (...args: any[]) => mockList(...args) },
}));

// Minimal, controllable stubs for the lib inputs so we can drive v-model.
const OSelectStub = {
  name: "OSelect",
  props: ["modelValue", "options", "label", "error", "errorMessage", "readonly", "disabled"],
  emits: ["update:modelValue"],
  template: `<div class="o-select" :data-error="error">
    <span class="o-select-options">{{ (options || []).join(',') }}</span>
  </div>`,
};
const OSwitchStub = {
  name: "OSwitch",
  props: ["modelValue", "label"],
  emits: ["update:modelValue"],
  template: `<button class="o-switch" @click="$emit('update:modelValue', !modelValue)">{{ label }}</button>`,
};

function createWrapper(props: Record<string, any> = {}) {
  return mount(FunctionPicker, {
    global: {
      plugins: [i18n, store],
      stubs: {
        OSelect: OSelectStub,
        OSwitch: OSwitchStub,
        OSpinner: true,
        OCard: { template: "<div><slot /></div>" },
        OCardSection: { template: "<div><slot /></div>" },
        OSeparator: true,
        OIcon: true,
        AddFunction: {
          name: "AddFunction",
          template: '<div class="add-function-stub"></div>',
          props: ["isUpdated", "heightOffset"],
          emits: ["update:list", "cancel:hideform"],
        },
      },
    },
    props,
  });
}

const listResponse = {
  data: {
    list: [
      { name: "alpha", function: "def alpha(r): r", trans_type: 0 },
      { name: "beta", function: "def beta(r): r", trans_type: 0 },
      { name: "js_fn", function: "() => {}", trans_type: 1 }, // JS — excluded
    ],
  },
};

describe("FunctionPicker", () => {
  beforeEach(() => {
    mockList.mockResolvedValue(listResponse);
  });
  afterEach(() => vi.clearAllMocks());

  it("mounts and self-fetches the VRL function list (excludes JS trans_type 1)", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(mockList).toHaveBeenCalled();
    const opts = wrapper.find(".o-select-options").text();
    expect(opts).toContain("alpha");
    expect(opts).toContain("beta");
    expect(opts).not.toContain("js_fn");
  });

  it("preselects initialName in edit mode", async () => {
    const wrapper = createWrapper({ initialName: "beta" });
    await flushPromises();
    expect((wrapper.vm as any).selectedFunction ?? "beta").toBeTruthy();
    // getPayload reflects the preselection
    expect((wrapper.vm as any).getPayload()).toMatchObject({ name: "beta" });
  });

  it("getPayload returns null and flags an error when nothing is selected", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).getPayload()).toBeNull();
    await flushPromises();
    expect(wrapper.find(".o-select").attributes("data-error")).toBe("true");
  });

  it("getPayload returns { name, after_flatten } with the flatten value", async () => {
    const wrapper = createWrapper({ initialName: "alpha", initialAfterFlatten: false });
    await flushPromises();
    expect((wrapper.vm as any).getPayload()).toEqual({
      name: "alpha",
      after_flatten: false,
    });
  });

  it("omits after_flatten when showFlatten is false", async () => {
    const wrapper = createWrapper({ initialName: "alpha", showFlatten: false });
    await flushPromises();
    expect((wrapper.vm as any).getPayload()).toEqual({ name: "alpha" });
  });

  it("blocks save (null) when the selected name is a duplicate", async () => {
    const wrapper = createWrapper({ initialName: "alpha", duplicateNames: ["alpha"] });
    await flushPromises();
    expect((wrapper.vm as any).getPayload()).toBeNull();
  });

  it("emits expand and returns null from getPayload while creating inline", async () => {
    const wrapper = createWrapper({ initialName: "alpha" });
    await flushPromises();
    // toggle the first switch (create-new)
    await wrapper.findAll(".o-switch")[0].trigger("click");
    expect(wrapper.emitted("expand")?.[0]).toEqual([true]);
    expect((wrapper.vm as any).getPayload()).toBeNull();
  });

  it("hides the After-Flattening toggle when showFlatten is false", async () => {
    const wrapper = createWrapper({ showFlatten: false });
    await flushPromises();
    expect(
      wrapper.find('[data-test="function-picker-after-flatten-toggle"]').exists(),
    ).toBe(false);
  });
});
