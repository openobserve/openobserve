// Copyright 2026 OpenObserve Inc.

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { z } from "zod";

import { raw } from "@/types/i18n";

import OForm from "../Form/OForm.vue";
import OFormSecretInput from "./OFormSecretInput.vue";
import type { SecretInputState } from "./OSecretInput.types";

const LABELS = {
  label: raw("Token"),
  unchangedLabel: raw("Unchanged"),
  replaceLabel: raw("Replace"),
  keepLabel: raw("Keep current"),
  willReplaceLabel: raw("Will be replaced on save"),
  showLabel: raw("Show value"),
  hideLabel: raw("Hide value"),
};

let wrapper: VueWrapper | null = null;

// The schema also runs as an async validator, which settles after a macrotask.
async function settle() {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

function mountForm(initial: SecretInputState, onSubmit: (v: { token: string | null }) => void) {
  const schema = z.object({
    token: z
      .string()
      .nullable()
      .refine((v) => v === null || v.length > 1, "Use at least 2 characters"),
  });
  const Host = defineComponent({
    setup() {
      const state = ref<SecretInputState>(initial);
      return () =>
        h(
          OForm,
          {
            defaultValues: { token: initial === "new" ? "" : null },
            schema,
            onSubmit,
          },
          {
            default: () => [
              h(OFormSecretInput, {
                ...LABELS,
                name: "token",
                state: state.value,
                dataTest: "token",
                "onUpdate:state": (value: SecretInputState) => (state.value = value),
              }),
              h("button", { type: "submit", "data-test": "save" }, "Save"),
            ],
          },
        );
    },
  });
  wrapper = mount(Host, { attachTo: document.body });
  return wrapper;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("OFormSecretInput", () => {
  it("submits null for an unchanged secret", async () => {
    let submitted: { token: string | null } | null = null;
    const w = mountForm("unchanged", (v) => (submitted = v));
    await w.find('[data-test="save"]').trigger("submit");
    await settle();
    expect(submitted).toEqual({ token: null });
  });

  it("submits the typed value after Replace", async () => {
    let submitted: { token: string | null } | null = null;
    const w = mountForm("unchanged", (v) => (submitted = v));
    await w.find('[data-test="token-replace"]').trigger("click");
    await flushPromises();
    await w.find("input").setValue("new-token");
    await w.find("form").trigger("submit");
    await settle();
    expect(submitted).toEqual({ token: "new-token" });
  });

  it("Keep current puts the field back to null", async () => {
    let submitted: { token: string | null } | null = null;
    const w = mountForm("unchanged", (v) => (submitted = v));
    await w.find('[data-test="token-replace"]').trigger("click");
    await flushPromises();
    await w.find("input").setValue("typed");
    await w.find('[data-test="token-keep"]').trigger("click");
    await flushPromises();
    await w.find("form").trigger("submit");
    await settle();
    expect(submitted).toEqual({ token: null });
  });

  it("Replace then Save without typing keeps the stored secret", async () => {
    let submitted: { token: string | null } | null = null;
    const w = mountForm("unchanged", (v) => (submitted = v));
    await w.find('[data-test="token-replace"]').trigger("click");
    await flushPromises();
    await w.find("form").trigger("submit");
    await settle();
    expect(submitted).toEqual({ token: null });
  });

  it("binds the schema message to the field", async () => {
    let submitted: unknown = null;
    const w = mountForm("new", (v) => (submitted = v));
    await w.find("input").setValue("x");
    await w.find("form").trigger("submit");
    await settle();
    expect(submitted).toBeNull();
    expect(w.text()).toContain("Use at least 2 characters");
    expect(w.find("input").attributes("aria-invalid")).toBe("true");
  });
});
