// Copyright 2026 OpenObserve Inc.

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { raw } from "@/types/i18n";

import OSecretInput from "./OSecretInput.vue";
import type { SecretInputProps, SecretInputState } from "./OSecretInput.types";

const LABELS = {
  label: raw("Header value"),
  unchangedLabel: raw("Unchanged"),
  replaceLabel: raw("Replace"),
  keepLabel: raw("Keep current"),
  willReplaceLabel: raw("Will be replaced on save"),
  showLabel: raw("Show value"),
  hideLabel: raw("Hide value"),
};

let wrapper: VueWrapper | null = null;

// A controlled harness: the parent owns value and state, as a real form does.
function mountSecret(state: SecretInputState, over: Partial<SecretInputProps> = {}) {
  wrapper = mount(OSecretInput, {
    props: {
      ...LABELS,
      modelValue: state === "unchanged" ? null : "",
      state,
      dataTest: "secret",
      ...over,
      "onUpdate:state": (value: SecretInputState) => wrapper!.setProps({ state: value }),
      "onUpdate:modelValue": (value: string | null) => wrapper!.setProps({ modelValue: value }),
    },
    attachTo: document.body,
  });
  return wrapper;
}

const emitted = (w: VueWrapper, name: string) =>
  (w.emitted(name) ?? []).map((args) => (args as unknown[])[0]);

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("OSecretInput", () => {
  it("shows the unchanged chip and Replace, with no input and no masked value", () => {
    const w = mountSecret("unchanged");
    expect(w.find('[data-test="secret-unchanged"]').text()).toContain("Unchanged");
    expect(w.find('[data-test="secret-replace"]').exists()).toBe(true);
    expect(w.find("input").exists()).toBe(false);
    expect(w.text()).not.toContain("***");
  });

  it("describes Replace by the unchanged chip", () => {
    const w = mountSecret("unchanged");
    const chipId = w.find('[data-test="secret-unchanged"]').attributes("id");
    expect(w.find('[data-test="secret-replace"]').attributes("aria-describedby")).toBe(chipId);
  });

  it("Replace opens an empty password field with focus and emits no empty secret", async () => {
    const w = mountSecret("unchanged");
    await w.find('[data-test="secret-replace"]').trigger("click");
    await flushPromises();
    const input = w.find("input");
    expect(input.attributes("type")).toBe("password");
    expect(input.attributes("spellcheck")).toBe("false");
    expect(input.attributes("autocapitalize")).toBe("off");
    expect((input.element as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input.element);
    expect(w.find('[data-test="secret-will-replace"]').exists()).toBe(false);
    expect(emitted(w, "update:state")).toEqual(["replacing"]);
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("a typed replacement shows the will-replace chip; clearing it keeps the stored secret", async () => {
    const w = mountSecret("replacing");
    await w.find("input").setValue("s3cret");
    const chip = w.find('[data-test="secret-will-replace"]');
    expect(chip.exists()).toBe(true);
    expect(w.find("input").attributes("aria-describedby")).toBe(chip.attributes("id"));
    await w.find("input").setValue("");
    expect(emitted(w, "update:modelValue")).toEqual(["s3cret", null]);
    expect(w.find('[data-test="secret-will-replace"]').exists()).toBe(false);
  });

  it("never emits the masked placeholder in any state change", async () => {
    const w = mountSecret("unchanged");
    await w.find('[data-test="secret-replace"]').trigger("click");
    await flushPromises();
    await w.find("input").setValue("s3cret");
    await w.find('[data-test="secret-keep"]').trigger("click");
    await flushPromises();
    expect(emitted(w, "update:modelValue")).toEqual(["s3cret", null]);
    expect(emitted(w, "update:modelValue")).not.toContain("***");
  });

  it("Keep current returns to unchanged and focuses Replace", async () => {
    const w = mountSecret("replacing");
    await w.find('[data-test="secret-keep"]').trigger("click");
    await flushPromises();
    expect(emitted(w, "update:state")).toEqual(["unchanged"]);
    expect(emitted(w, "update:modelValue")).toEqual([null]);
    expect(document.activeElement).toBe(w.find('[data-test="secret-replace"]').element);
  });

  it("Escape while replacing keeps the current value", async () => {
    const w = mountSecret("replacing");
    await w.find("input").trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(emitted(w, "update:state")).toEqual(["unchanged"]);
  });

  it("ignores Escape while an IME composition is open", async () => {
    const w = mountSecret("replacing");
    await w.find("input").trigger("keydown", { key: "Escape", isComposing: true });
    expect(w.emitted("update:state")).toBeUndefined();
  });

  it("a new secret has no Keep current and Escape does nothing", async () => {
    const w = mountSecret("new");
    expect(w.find('[data-test="secret-keep"]').exists()).toBe(false);
    expect(w.find('[data-test="secret-will-replace"]').exists()).toBe(false);
    await w.find("input").trigger("keydown", { key: "Escape" });
    expect(w.emitted("update:state")).toBeUndefined();
  });

  it("the visibility toggle is a named button that flips the field type", async () => {
    const w = mountSecret("new");
    const toggle = w.find('[data-test="secret-visibility"]');
    expect(toggle.element.tagName).toBe("BUTTON");
    expect(toggle.attributes("aria-label")).toBe("Show value");
    expect(toggle.attributes("aria-pressed")).toBeUndefined();
    await toggle.trigger("click");
    expect(w.find("input").attributes("type")).toBe("text");
    expect(w.find('[data-test="secret-visibility"]').attributes("aria-label")).toBe("Hide value");
  });

  it("hides a revealed value again when the field closes and reopens", async () => {
    const w = mountSecret("replacing");
    await w.find('[data-test="secret-visibility"]').trigger("click");
    await w.find('[data-test="secret-keep"]').trigger("click");
    await flushPromises();
    await w.find('[data-test="secret-replace"]').trigger("click");
    await flushPromises();
    expect(w.find("input").attributes("type")).toBe("password");
  });

  it("disables Replace when disabled", () => {
    const w = mountSecret("unchanged", { disabled: true });
    expect(w.find('[data-test="secret-replace"]').attributes("disabled")).toBeDefined();
  });
});
