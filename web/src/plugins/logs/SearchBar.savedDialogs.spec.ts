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

// Validation tests for SearchBar's two migrated dialogs (rows 58 + 59).
//
// SearchBar.vue itself can't be mounted in unit tests — its setup() pulls a
// dozen composables (per the note in SearchBar.spec.ts), so the existing suite
// uses lightweight harnesses. Following that pattern, this file:
//   1. tests each conditional schema directly (the restored required + regex
//      rules, mode-aware via isSavedViewAction / isSavedFunctionAction); and
//   2. mounts the schema in a REAL <OForm> with the dialog's exact OForm*
//      fields to prove the schema gates an empty/invalid submit (R22).

import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, watch } from "vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  makeSavedViewSchema,
  type SavedViewForm,
} from "./SearchBar.SavedView.schema";
import {
  makeSavedFunctionSchema,
  type SavedFunctionForm,
} from "./SearchBar.SavedFunction.schema";

const t = (k: string) => k;
const savedViewSchema = makeSavedViewSchema(t);
const savedFunctionSchema = makeSavedFunctionSchema(t);

// ── Direct schema tests ──────────────────────────────────────────────────────
describe("SavedView schema (row 58)", () => {
  it("create: requires a non-empty name", () => {
    const r = savedViewSchema.safeParse({
      isSavedViewAction: "create",
      savedViewName: "",
      savedViewSelectedName: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe("validation.required");
    }
  });

  it("create: rejects a non-alphanumeric name (restored regex)", () => {
    const r = savedViewSchema.safeParse({
      isSavedViewAction: "create",
      savedViewName: "bad@name!",
      savedViewSelectedName: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe("validation.alphanumeric");
    }
  });

  it("create: accepts an alphanumeric name with spaces/_/-", () => {
    const r = savedViewSchema.safeParse({
      isSavedViewAction: "create",
      savedViewName: "My_View - 1",
      savedViewSelectedName: "",
    });
    expect(r.success).toBe(true);
  });

  it("update: requires a selected view", () => {
    const empty = savedViewSchema.safeParse({
      isSavedViewAction: "update",
      savedViewName: "",
      savedViewSelectedName: "",
    });
    expect(empty.success).toBe(false);
    if (!empty.success) {
      expect(empty.error.issues[0].message).toBe("validation.fieldRequired");
    }

    const ok = savedViewSchema.safeParse({
      isSavedViewAction: "update",
      savedViewName: "",
      savedViewSelectedName: "view-123",
    });
    expect(ok.success).toBe(true);
  });
});

describe("SavedFunction schema (row 59)", () => {
  it("create: requires a non-empty name", () => {
    const r = savedFunctionSchema.safeParse({
      isSavedFunctionAction: "create",
      savedFunctionName: "",
      savedFunctionSelectedName: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe("validation.required");
    }
  });

  it("create: rejects names not matching the identifier regex", () => {
    for (const bad of ["123abc", "_foo", "has space", "no-dash"]) {
      const r = savedFunctionSchema.safeParse({
        isSavedFunctionAction: "create",
        savedFunctionName: bad,
        savedFunctionSelectedName: "",
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0].message).toBe("validation.alphanumeric");
      }
    }
  });

  it("create: accepts a valid identifier name", () => {
    const r = savedFunctionSchema.safeParse({
      isSavedFunctionAction: "create",
      savedFunctionName: "myFunction_1",
      savedFunctionSelectedName: "",
    });
    expect(r.success).toBe(true);
  });

  it("update: requires a selected function", () => {
    const empty = savedFunctionSchema.safeParse({
      isSavedFunctionAction: "update",
      savedFunctionName: "",
      savedFunctionSelectedName: "",
    });
    expect(empty.success).toBe(false);

    const ok = savedFunctionSchema.safeParse({
      isSavedFunctionAction: "update",
      savedFunctionName: "",
      savedFunctionSelectedName: "existingFn",
    });
    expect(ok.success).toBe(true);
  });
});

// ── Real-OForm wiring tests ───────────────────────────────────────────────────
// Mirror each dialog's OForm body so the schema is exercised through a real
// <OForm>, proving an empty/invalid required field blocks submit and a valid
// one passes (the AddToDashboard/AddRegexPattern unwired-schema bug guard).
describe("SavedView dialog — real OForm", () => {
  const Harness = defineComponent({
    props: { mode: { type: String, default: "create" } },
    emits: ["save"],
    setup(props, { emit, expose }) {
      const onSubmit = (v: SavedViewForm) => emit("save", v);
      const defaults = (): SavedViewForm => ({
        isSavedViewAction: props.mode,
        savedViewName: "",
        savedViewSelectedName: "",
      });
      expose({});
      return () =>
        h(
          OForm,
          {
            id: "saved-view-form",
            schema: savedViewSchema,
            defaultValues: defaults(),
            onSubmit,
          },
          () =>
            props.mode === "create"
              ? h(OFormInput, { name: "savedViewName", label: "Name" })
              : h(OFormSelect, {
                  name: "savedViewSelectedName",
                  label: "View",
                  options: [{ view_name: "A", view_id: "a" }],
                  labelKey: "view_name",
                  valueKey: "view_id",
                }),
        );
    },
  });

  const getForm = (w: any) =>
    (w.findComponent({ name: "OForm" }).vm as any).form;

  it("create: blocks submit on empty name", async () => {
    const w = mount(Harness, { props: { mode: "create" } });
    await getForm(w).handleSubmit();
    await flushPromises();
    expect(getForm(w).state.isValid).toBe(false);
    expect(w.emitted("save")).toBeFalsy();
  });

  it("create: submits a valid name", async () => {
    const w = mount(Harness, { props: { mode: "create" } });
    getForm(w).setFieldValue("savedViewName", "Valid_View");
    await getForm(w).handleSubmit();
    await flushPromises();
    expect(getForm(w).state.isValid).toBe(true);
    expect((w.emitted("save")![0][0] as any).savedViewName).toBe("Valid_View");
  });

  it("update: blocks submit on empty selection", async () => {
    const w = mount(Harness, { props: { mode: "update" } });
    await getForm(w).handleSubmit();
    await flushPromises();
    expect(getForm(w).state.isValid).toBe(false);
    expect(w.emitted("save")).toBeFalsy();
  });
});

describe("SavedFunction dialog — real OForm", () => {
  const Harness = defineComponent({
    props: { mode: { type: String, default: "create" } },
    emits: ["save"],
    setup(props, { emit }) {
      const onSubmit = (v: SavedFunctionForm) => emit("save", v);
      const defaults = (): SavedFunctionForm => ({
        isSavedFunctionAction: props.mode,
        savedFunctionName: "",
        savedFunctionSelectedName: "",
      });
      return () =>
        h(
          OForm,
          {
            id: "saved-function-form",
            schema: savedFunctionSchema,
            defaultValues: defaults(),
            onSubmit,
          },
          () =>
            props.mode === "create"
              ? h(OFormInput, { name: "savedFunctionName", label: "Name" })
              : h(OFormSelect, {
                  name: "savedFunctionSelectedName",
                  label: "Function",
                  options: [{ name: "fnA" }],
                  labelKey: "name",
                  valueKey: "name",
                }),
        );
    },
  });

  const getForm = (w: any) =>
    (w.findComponent({ name: "OForm" }).vm as any).form;

  it("create: blocks submit on empty name", async () => {
    const w = mount(Harness, { props: { mode: "create" } });
    await getForm(w).handleSubmit();
    await flushPromises();
    expect(getForm(w).state.isValid).toBe(false);
    expect(w.emitted("save")).toBeFalsy();
  });

  it("create: blocks submit on an invalid identifier", async () => {
    const w = mount(Harness, { props: { mode: "create" } });
    getForm(w).setFieldValue("savedFunctionName", "123bad");
    await getForm(w).handleSubmit();
    await flushPromises();
    expect(getForm(w).state.isValid).toBe(false);
    expect(w.emitted("save")).toBeFalsy();
  });

  it("create: submits a valid identifier", async () => {
    const w = mount(Harness, { props: { mode: "create" } });
    getForm(w).setFieldValue("savedFunctionName", "myFn_1");
    await getForm(w).handleSubmit();
    await flushPromises();
    expect(getForm(w).state.isValid).toBe(true);
    expect((w.emitted("save")![0][0] as any).savedFunctionName).toBe("myFn_1");
  });

  it("update: blocks submit on empty selection", async () => {
    const w = mount(Harness, { props: { mode: "update" } });
    await getForm(w).handleSubmit();
    await flushPromises();
    expect(getForm(w).state.isValid).toBe(false);
    expect(w.emitted("save")).toBeFalsy();
  });
});

// ── Mode-switch dependent reset (parity with the pre-migration toggle) ─────────
// The old dialog cleared the name on every toggle
// (`@update:model-value="isSavedFunctionAction = $event; savedFunctionName = ''"`).
// After migration the OFormToggleGroup only records the mode, so SearchBar's
// setup() re-adds that clear via a watch on the form-owned mode field. SearchBar
// itself can't be mounted (see header), so this harness mirrors its owner-pattern
// wiring (useOForm + the mode-change watch) exactly and proves the toggle blanks
// the create-mode name field without surfacing a premature "required" error.
describe("SavedFunction dialog — mode toggle clears the name", () => {
  const Harness = defineComponent({
    setup(_, { expose }) {
      const form = useOForm<SavedFunctionForm>({
        defaultValues: {
          isSavedFunctionAction: "create",
          savedFunctionName: "",
          savedFunctionSelectedName: "",
        },
        schema: savedFunctionSchema,
        onSubmit: () => {},
      });
      const mode = form.useStore(
        (s) => (s.values.isSavedFunctionAction as string) ?? "create",
      );
      // Same watch SearchBar.vue installs in setup().
      watch(mode, () => {
        form.setFieldValue("savedFunctionName", "", {
          dontUpdateMeta: true,
          dontValidate: true,
        });
      });
      expose({ form });
      return () => h("div");
    },
  });

  it("blanks savedFunctionName when the mode toggles create→update", async () => {
    const w = mount(Harness);
    const form = (w.vm as any).form;
    // User types a name in create mode.
    form.setFieldValue("savedFunctionName", "myFn_1");
    expect(form.state.values.savedFunctionName).toBe("myFn_1");
    // Toggling the OFormToggleGroup writes the mode field.
    form.setFieldValue("isSavedFunctionAction", "update");
    await flushPromises();
    expect(form.state.values.savedFunctionName).toBe("");
  });

  it("clearing on toggle does not surface a 'required' error on the name", async () => {
    const w = mount(Harness);
    const form = (w.vm as any).form;
    form.setFieldValue("savedFunctionName", "myFn_1");
    form.setFieldValue("isSavedFunctionAction", "update");
    await flushPromises();
    // Toggle back to create: the freshly-cleared field must not pre-show an error.
    form.setFieldValue("isSavedFunctionAction", "create");
    await flushPromises();
    const meta = form.getFieldMeta("savedFunctionName");
    expect(meta?.errors ?? []).toHaveLength(0);
  });
});
