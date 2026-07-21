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
    // NOTE: the real /functions list response uses camelCase `transType` (a
    // number), NOT snake_case `trans_type`. The fixture must match the API or
    // the language filter silently passes/rejects everything.
    list: [
      { name: "alpha", function: "def alpha(r): r", transType: 0 },
      { name: "beta", function: "def beta(r): r", transType: 0 },
      { name: "js_fn", function: "() => {}", transType: 1 },
    ],
  },
};

describe("FunctionPicker", () => {
  beforeEach(() => {
    mockList.mockResolvedValue(listResponse);
  });
  afterEach(() => vi.clearAllMocks());

  // The list is filtered to the HOST's execution language: a pipeline runs VRL,
  // a workflow Function node runs JS. Offering the other kind would let a user
  // attach a function the node could never execute.
  it("defaults to the VRL list (excludes JS trans_type 1)", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(mockList).toHaveBeenCalled();
    const opts = wrapper.find(".o-select-options").text();
    expect(opts).toContain("alpha");
    expect(opts).toContain("beta");
    expect(opts).not.toContain("js_fn");
  });

  it("language='vrl' (pipeline): offers only VRL functions", async () => {
    const wrapper = createWrapper({ language: "vrl" });
    await flushPromises();
    const opts = wrapper.find(".o-select-options").text();
    expect(opts).toContain("alpha");
    expect(opts).toContain("beta");
    expect(opts).not.toContain("js_fn");
  });

  it("language='javascript' (workflow): offers ONLY JS functions", async () => {
    const wrapper = createWrapper({ language: "javascript" });
    await flushPromises();
    const opts = wrapper.find(".o-select-options").text();
    expect(opts).toContain("js_fn");
    expect(opts).not.toContain("alpha");
    expect(opts).not.toContain("beta");
  });

  it("preselects initialName in edit mode", async () => {
    const wrapper = createWrapper({ initialName: "beta" });
    await flushPromises();
    await expect((wrapper.vm as any).submit()).resolves.toMatchObject({
      name: "beta",
    });
  });

  // Required is now enforced by the shared AssociateFunction schema (min(1)) and
  // rendered inline on the field — not by a hand-rolled `showRequiredError` flag.
  it("submit resolves null when nothing is selected", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    await expect((wrapper.vm as any).submit()).resolves.toBeNull();
  });

  it("submit resolves { name, after_flatten } with the flatten value", async () => {
    const wrapper = createWrapper({ initialName: "alpha", initialAfterFlatten: false });
    await flushPromises();
    await expect((wrapper.vm as any).submit()).resolves.toEqual({
      name: "alpha",
      after_flatten: false,
    });
  });

  it("omits after_flatten when showFlatten is false", async () => {
    const wrapper = createWrapper({ initialName: "alpha", showFlatten: false });
    await flushPromises();
    await expect((wrapper.vm as any).submit()).resolves.toEqual({ name: "alpha" });
  });

  // Uniqueness is the schema's superRefine ("already associated"), replacing the
  // old `functionExists` computed.
  it("blocks save (null) when the selected name is a duplicate", async () => {
    const wrapper = createWrapper({ initialName: "alpha", duplicateNames: ["alpha"] });
    await flushPromises();
    await expect((wrapper.vm as any).submit()).resolves.toBeNull();
  });

  it("allows a duplicate name while updating (edit mode)", async () => {
    const wrapper = createWrapper({
      initialName: "alpha",
      duplicateNames: ["alpha"],
      isUpdating: true,
    });
    await flushPromises();
    await expect((wrapper.vm as any).submit()).resolves.toMatchObject({
      name: "alpha",
    });
  });

  it("emits expand and resolves null from submit while creating inline", async () => {
    const wrapper = createWrapper({ initialName: "alpha" });
    await flushPromises();
    // toggle the first switch (create-new)
    await wrapper.findAll(".o-switch")[0].trigger("click");
    expect(wrapper.emitted("expand")?.[0]).toEqual([true]);
    await expect((wrapper.vm as any).submit()).resolves.toBeNull();
  });

  it("hides the After-Flattening toggle when showFlatten is false", async () => {
    const wrapper = createWrapper({ showFlatten: false });
    await flushPromises();
    expect(
      wrapper.find('[data-test="associate-function-after-flattening-toggle"]').exists(),
    ).toBe(false);
  });
});
