// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import { z } from "zod";
import i18n from "@/locales";
import OForm from "../Form/OForm.vue";
import { useOForm } from "../Form/useOForm";
import OFormInput from "../Input/OFormInput.vue";
import { rebaseSavedValues } from "./formCounts";
import OSaveBar from "./OSaveBar.vue";

const schema = z
  .object({
    name: z.string().min(1, "Name required"),
    email: z.string().min(1, "Email required"),
    low: z.coerce.number(),
    high: z.coerce.number(),
    limits: z.object({ start: z.coerce.number(), max: z.coerce.number() }),
  })
  .superRefine((v, ctx) => {
    if (v.limits.max < v.limits.start)
      for (const path of ["start", "max"])
        ctx.addIssue({ code: "custom", path: ["limits", path], message: "Max below start" });
    if (v.high >= v.low) return;
    for (const path of ["low", "high"])
      ctx.addIssue({ code: "custom", path: [path], message: "High below low" });
  });
const SAVED = { name: "a", email: "a@b.c", low: 1, high: 5, limits: { start: 1, max: 5 } };
const FIELDS = ["name", "email", "low", "high", "limits.start", "limits.max"];

const submitted = vi.fn();
// Set by a test to keep the save request open.
let pendingSave: Promise<void> | undefined;
// Set by a test to what the server stored, when that differs from what was sent.
let storedAs: ((sent: any) => any) | undefined;

const Host = defineComponent({
  components: { OForm, OFormInput, OSaveBar },
  props: {
    loaded: { type: Boolean, default: true },
    saving: { type: Boolean, default: undefined },
    outside: { type: Boolean, default: false },
    create: { type: Object, default: undefined },
  },
  setup() {
    const form = useOForm({
      defaultValues: SAVED as Record<string, unknown>,
      schema,
      validateOn: "leave",
      coupled: [
        ["low", "high"],
        ["limits.start", "limits.max"],
      ],
      onSubmit: async (values) => {
        submitted(values);
        await pendingSave;
        rebaseSavedValues(form, storedAs ? storedAs(values) : values, values);
      },
    });
    return { form, fields: FIELDS };
  },
  template: `
    <OForm id="host-form" :form="form">
      <div v-for="f in fields" :key="f" :data-row="f">
        <OFormInput :name="f" :label="f" />
      </div>
      <OSaveBar v-if="!outside" :loaded="loaded" :saving="saving" v-bind="create" />
    </OForm>
    <OSaveBar v-if="outside" :form="form" form-id="host-form" save-data-test="legacy-save" />`,
});

const text = (key: string, n?: number) =>
  n === undefined ? i18n.global.t(key) : i18n.global.t(key, n);
const input = (w: VueWrapper, f: string) => w.find(`[data-row="${f}"] input`);
const part = (w: VueWrapper, name: string) => w.find(`[data-test="save-bar-${name}"]`);
const barState = (w: VueWrapper) => w.find('[data-test="save-bar"]').attributes("data-state");

async function type(w: VueWrapper, f: string, value: string) {
  await input(w, f).setValue(value);
  await flushPromises();
}

async function leave(w: VueWrapper, f: string) {
  await input(w, f).trigger("blur");
  await flushPromises();
}

describe("OSaveBar", () => {
  afterEach(() => submitted.mockClear());

  it.each([
    { name: "loading", props: { loaded: false }, edits: {}, discard: false, save: false },
    { name: "clean", props: {}, edits: {}, status: "noChanges", discard: false, save: false },
    // A number field hands back text; the saved digits typed again are not a change.
    {
      name: "clean",
      props: {},
      edits: { low: "1" },
      status: "noChanges",
      discard: false,
      save: false,
    },
    { name: "changed", props: {}, edits: { name: "b" }, count: 1, discard: true, save: true },
    {
      name: "changed",
      props: {},
      edits: { name: "b", email: "c@d.e" },
      count: 2,
      discard: true,
      save: true,
    },
    {
      name: "invalid",
      props: {},
      edits: { name: "", email: "c@d.e" },
      blur: "name",
      count: 2,
      fix: 1,
      discard: true,
      save: true,
    },
    // A coupled pair marks both members and is one field to fix.
    {
      name: "invalid",
      props: {},
      edits: { low: "9" },
      blur: "low",
      count: 1,
      fix: 1,
      discard: true,
      save: true,
    },
    {
      name: "saving",
      props: { saving: true },
      edits: { name: "b" },
      count: 1,
      discard: "disabled",
      save: true,
    },
  ])(
    "status and buttons follow clean, changed, invalid, saving and loading ($name)",
    async (row) => {
      const w = mount(Host, { props: row.props });
      for (const [f, v] of Object.entries(row.edits)) await type(w, f, v);
      if (row.blur) await leave(w, row.blur);

      await vi.waitFor(() => expect(barState(w)).toBe(row.name));
      const status = part(w, "status").text();
      if (row.status) expect(status).toBe(text(`common.saveBar.${row.status}`));
      if (row.count) expect(status).toContain(text("common.saveBar.unsavedChanges", row.count));
      expect(part(w, "fix").exists()).toBe(!!row.fix);
      if (row.fix) expect(part(w, "fix").text()).toBe(text("common.saveBar.fixFields", row.fix));
      expect(part(w, "discard").exists()).toBe(!!row.discard);
      if (row.discard === "disabled") {
        expect(part(w, "discard").attributes("disabled")).toBeDefined();
      }
      // Save is unavailable only when there is nothing to save; an invalid change keeps it pressable.
      expect(part(w, "save").attributes("disabled") === undefined).toBe(row.save);
    },
  );

  it("Save on an invalid form sends nothing and focuses the first invalid field", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const w = mount(Host, { attachTo: document.body });
    await type(w, "email", "");
    expect(part(w, "fix").exists()).toBe(false);

    await part(w, "save").trigger("click");
    await flushPromises();

    expect(submitted).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(input(w, "email").element));
    expect(input(w, "email").attributes("aria-invalid")).toBe("true");

    (document.activeElement as HTMLElement).blur();
    await part(w, "fix").trigger("click");
    await vi.waitFor(() => expect(document.activeElement).toBe(input(w, "email").element));
    w.unmount();
  });

  it("Discard restores the saved values and returns to clean", async () => {
    const w = mount(Host);
    await type(w, "name", "b");
    await part(w, "save").trigger("click");
    await flushPromises();
    await vi.waitFor(() => expect(submitted).toHaveBeenCalledWith({ ...SAVED, name: "b" }));
    await vi.waitFor(() => expect(barState(w)).toBe("clean"));

    await type(w, "name", "c");
    await part(w, "discard").trigger("click");
    await flushPromises();

    expect((input(w, "name").element as HTMLInputElement).value).toBe("b");
    expect(barState(w)).toBe("clean");
    expect(w.findComponent(OSaveBar).emitted("discard")).toHaveLength(1);
  });

  it("an edit made while the save is pending stays, as the one unsaved change", async () => {
    let finish = () => {};
    pendingSave = new Promise((resolve) => (finish = resolve));
    const w = mount(Host);
    await type(w, "name", "b");
    await type(w, "email", "c@d.e");
    await part(w, "save").trigger("click");
    await vi.waitFor(() => expect(submitted).toHaveBeenCalled());

    await type(w, "name", "later");
    await type(w, "email", "");
    await leave(w, "email");
    await type(w, "limits.start", "9");
    await leave(w, "limits.start");
    finish();
    pendingSave = undefined;
    await flushPromises();

    expect((input(w, "name").element as HTMLInputElement).value).toBe("later");
    expect(part(w, "status").text()).toContain(text("common.saveBar.unsavedChanges", 3));
    // Fields left invalid during the request are still unfixed: their errors stay, a nested coupled pair included.
    expect(
      ["email", "limits.start", "limits.max"].map((f) => input(w, f).attributes("aria-invalid")),
    ).toEqual(["true", "true", "true"]);
    expect(part(w, "fix").text()).toBe(text("common.saveBar.fixFields", 2));
    await part(w, "discard").trigger("click");
    await flushPromises();
    expect(
      ["name", "email", "limits.start"].map((f) => (input(w, f).element as HTMLInputElement).value),
    ).toEqual(["b", "c@d.e", "1"]);
    w.unmount();
  });

  it("a nested field edited while the save is pending keeps its edit, and its sibling takes the stored value", async () => {
    let finish = () => {};
    pendingSave = new Promise((resolve) => (finish = resolve));
    storedAs = (sent) => ({ ...sent, limits: { ...sent.limits, max: 10 } });
    const w = mount(Host);
    await type(w, "name", "b");
    await part(w, "save").trigger("click");
    await vi.waitFor(() => expect(submitted).toHaveBeenCalled());

    await type(w, "limits.start", "9");
    finish();
    pendingSave = undefined;
    await flushPromises();
    storedAs = undefined;

    expect(
      ["limits.start", "limits.max"].map((f) => (input(w, f).element as HTMLInputElement).value),
    ).toEqual(["9", "10"]);
    expect(part(w, "status").text()).toContain(text("common.saveBar.unsavedChanges", 1));
    w.unmount();
  });

  it("create mode saves an untouched form, offers Cancel, and can be a plain step button", async () => {
    const w = mount(Host, { props: { create: { mode: "create" } } });
    expect(part(w, "status").text()).toBe("");
    expect(part(w, "discard").exists()).toBe(false);
    await part(w, "cancel").trigger("click");
    expect(w.findComponent(OSaveBar).emitted("cancel")).toHaveLength(1);
    await part(w, "save").trigger("click");
    await vi.waitFor(() => expect(submitted).toHaveBeenCalledWith(SAVED));

    submitted.mockClear();
    await w.setProps({ create: { mode: "create", submit: false, saveLabel: "Continue" } });
    expect(part(w, "save").text()).toBe("Continue");
    await part(w, "save").trigger("click");
    await flushPromises();
    expect(submitted).not.toHaveBeenCalled();
    expect(w.findComponent(OSaveBar).emitted("save")).toHaveLength(2);

    await w.setProps({ create: { mode: "create", submit: false, saveDisabled: true } });
    expect(part(w, "save").attributes("disabled")).toBeDefined();
    w.unmount();
  });

  it.each([{ outside: false }, { outside: true }])(
    "Enter in a field saves once, and only when something changed (bar outside the form: $outside)",
    async ({ outside }) => {
      const w = mount(Host, { props: { outside }, attachTo: document.body });
      // A browser turns Enter in a text field into a click on the form's submit button, unless it is disabled.
      const pressEnter = () => {
        const formEl = (input(w, "name").element as HTMLInputElement).form;
        const button = [
          ...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
        ].find((b) => b.form === formEl);
        if (button && !button.disabled) button.click();
        return button?.dataset.test;
      };

      expect(pressEnter()).toBe(outside ? "legacy-save" : "save-bar-save");
      await flushPromises();
      expect(submitted).not.toHaveBeenCalled();

      await type(w, "name", "b");
      pressEnter();
      await vi.waitFor(() => expect(barState(w)).toBe("clean"));
      expect(submitted).toHaveBeenCalledTimes(1);
      w.unmount();
    },
  );
});
