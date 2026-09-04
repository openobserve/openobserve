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

// The live editor code AddFunction.getCode() returns — tests set it to simulate the
// user typing / editing (the real editor is imperative; the picker reads it on demand).
let mockEditorCode = "";

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
        OButton: {
          name: "OButton",
          props: ["iconLeft", "variant", "size"],
          emits: ["click"],
          template: '<button class="o-btn" @click="$emit(\'click\')"><slot /></button>',
        },
        OSpinner: true,
        OCard: { template: "<div><slot /></div>" },
        OCardSection: { template: "<div><slot /></div>" },
        OSeparator: true,
        OIcon: true,
        AddFunction: {
          name: "AddFunction",
          template: '<div class="add-function-stub">{{ defaultCode }}</div>',
          props: ["isUpdated", "heightOffset", "defaultCode", "forcedLanguage", "sampleEvents"],
          emits: ["update:list", "cancel:hideform"],
          // Mirrors the real AddFunction's only exposed method; returns the mock code
          // unless a test left it empty, in which case it echoes the seed (matches the
          // real editor, which starts at default-code).
          setup(props: any, { expose }: any) {
            expose({ getCode: () => (mockEditorCode !== "" ? mockEditorCode : props.defaultCode) });
          },
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
    mockEditorCode = "";
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

  // Optional mode (Workflows dummy node): an empty selection is allowed — submit
  // resolves an empty name (placeholder) instead of null, and no required error.
  it("optional: submit resolves an empty name when nothing is selected", async () => {
    const wrapper = createWrapper({ optional: true });
    await flushPromises();
    await expect((wrapper.vm as any).submit()).resolves.toEqual({
      name: "",
      after_flatten: true,
    });
  });

  it("optional: still resolves the chosen function when one is selected", async () => {
    const wrapper = createWrapper({
      optional: true,
      initialName: "alpha",
      initialAfterFlatten: false,
    });
    await flushPromises();
    await expect((wrapper.vm as any).submit()).resolves.toEqual({
      name: "alpha",
      after_flatten: false,
    });
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
    expect(wrapper.find('[data-test="associate-function-after-flattening-toggle"]').exists()).toBe(
      false,
    );
  });

  // Single-screen mode (workflows): the select AND the create editor are BOTH on one
  // page — no mode switch, no view swap. Pipelines keep the switch.
  it("createButton: shows the select and the create editor together (no mode switch)", async () => {
    const wrapper = createWrapper({ createButton: true });
    await flushPromises();
    expect(wrapper.find(".o-select").exists()).toBe(true); // pick existing
    expect(wrapper.find(".add-function-stub").exists()).toBe(true); // create new — same page
    expect(wrapper.find('[data-test="create-function-toggle"]').exists()).toBe(false);
  });

  it("createButton: does not emit expand (inline on one page, no drawer widen swap)", async () => {
    const wrapper = createWrapper({ createButton: true });
    await flushPromises();
    expect(wrapper.emitted("expand")).toBeFalsy();
  });

  it("createButton: selecting a function fills its definition into the editor", async () => {
    // 'alpha' is a VRL function in the fixture — preselect it, then the editor's
    // default-code should be that function's definition.
    const wrapper = createWrapper({ createButton: true, language: "vrl", initialName: "alpha" });
    await flushPromises();
    const addFn = wrapper.findComponent({ name: "AddFunction" });
    expect(addFn.props("defaultCode")).toBe("def alpha(r): r");
  });

  it("keeps the mode switch by default (pipelines)", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find('[data-test="create-function-toggle"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="create-function-open"]').exists()).toBe(false);
  });

  // ── Workflow inline JS (raw_fn) + dirty tracking ─────────────────────────────
  // Single-screen workflow: the editor can hold inline/edited code that isn't backed
  // by a saved function. submit() then sends `raw_fn` (empty name) instead of a name;
  // a clean saved-fn selection sends `{ name, raw_fn: undefined }` so any stale raw_fn
  // is cleared. isDirty() drives the NDV's save/discard exit prompt.
  const wf = (props: Record<string, any> = {}) =>
    createWrapper({ createButton: true, optional: true, language: "javascript", ...props });

  it("clean selection (no edits) → submit sends the name and clears raw_fn", async () => {
    const wrapper = wf({ initialName: "js_fn", initialAfterFlatten: false });
    await flushPromises();
    // editor equals the saved code → not dirty
    mockEditorCode = "() => {}";
    expect((wrapper.vm as any).isDirty()).toBe(false);
    await expect((wrapper.vm as any).submit()).resolves.toEqual({
      name: "js_fn",
      raw_fn: undefined,
      after_flatten: false,
    });
  });

  it("edited saved fn (unsaved) → submit sends raw_fn with an empty name", async () => {
    const wrapper = wf({ initialName: "js_fn", initialAfterFlatten: true });
    await flushPromises();
    mockEditorCode = "() => { return 1 }"; // diverges from saved "() => {}"
    expect((wrapper.vm as any).isDirty()).toBe(true);
    await expect((wrapper.vm as any).submit()).resolves.toEqual({
      name: "",
      raw_fn: "() => { return 1 }",
      after_flatten: true,
    });
  });

  it("pure inline code (no fn selected) → submit sends raw_fn", async () => {
    const wrapper = wf({ initialAfterFlatten: false, defaultCode: "// seed" });
    await flushPromises();
    mockEditorCode = "() => 42"; // real code, none selected, differs from the seed
    expect((wrapper.vm as any).isDirty()).toBe(true);
    await expect((wrapper.vm as any).submit()).resolves.toEqual({
      name: "",
      raw_fn: "() => 42",
      after_flatten: false,
    });
  });

  it("untouched seed (no fn, only default code) → not dirty, empty-name dummy", async () => {
    const wrapper = wf({ defaultCode: "// seed" });
    await flushPromises();
    mockEditorCode = "// seed"; // still the seed → nothing to save
    expect((wrapper.vm as any).isDirty()).toBe(false);
    await expect((wrapper.vm as any).submit()).resolves.toEqual({
      name: "",
      raw_fn: undefined,
      after_flatten: true,
    });
  });

  it("initialRawFn seeds the editor when reopening an inline (nameless) node", async () => {
    const wrapper = wf({ initialRawFn: "() => 'persisted'" });
    await flushPromises();
    const addFn = wrapper.findComponent({ name: "AddFunction" });
    expect(addFn.props("defaultCode")).toBe("() => 'persisted'");
  });

  it("reopened, untouched inline raw_fn node is NOT dirty (seed = initialRawFn)", async () => {
    // Reopen a saved inline node: editor seeds from initialRawFn, defaultCode is the
    // fresh-node placeholder. Nothing typed → must be clean (no spurious exit prompt).
    const wrapper = wf({ initialRawFn: "() => 'persisted'", defaultCode: "// seed" });
    await flushPromises();
    expect((wrapper.vm as any).isDirty()).toBe(false);
  });

  it("editing a reopened inline raw_fn node past its persisted code → dirty", async () => {
    const wrapper = wf({ initialRawFn: "() => 'persisted'", defaultCode: "// seed" });
    await flushPromises();
    mockEditorCode = "() => 'edited'"; // diverges from the persisted raw_fn
    expect((wrapper.vm as any).isDirty()).toBe(true);
  });

  it("isDirty() is false outside single-screen mode (raw_fn is workflow-only)", async () => {
    const wrapper = createWrapper({ language: "javascript", initialName: "js_fn" });
    await flushPromises();
    mockEditorCode = "() => { changed }";
    expect((wrapper.vm as any).isDirty()).toBe(false);
  });
});
