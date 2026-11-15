import { describe, it, expect, afterEach } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { sameFormValues, useUnsavedChanges } from "./unsavedEdits";

const press = (key = "a") =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
const click = () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));

describe("sameFormValues", () => {
  it("ignores key order", () => {
    expect(sameFormValues({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
  });

  it("treats undefined, null, empty text and a missing key as the same empty value", () => {
    expect(sameFormValues({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameFormValues({ a: null }, { a: "" })).toBe(true);
    expect(sameFormValues({ tags: [] }, {})).toBe(true);
  });

  it("compares a number and a numeric string by value", () => {
    expect(sameFormValues({ port: 5 }, { port: "5" })).toBe(true);
    expect(sameFormValues({ port: "5.0" }, { port: 5 })).toBe(true);
    expect(sameFormValues({ port: 5 }, { port: "6" })).toBe(false);
    expect(sameFormValues({ port: 0 }, { port: "" })).toBe(false);
  });

  it("still sees a real difference", () => {
    expect(sameFormValues({ name: "a" }, { name: "b" })).toBe(false);
    expect(sameFormValues({ tags: ["a"] }, { tags: ["a", "b"] })).toBe(false);
    expect(sameFormValues({ tags: ["a", "b"] }, { tags: ["b", "a"] })).toBe(false);
    expect(sameFormValues({ on: false }, { on: true })).toBe(false);
    expect(sameFormValues({ name: "x" }, {})).toBe(false);
    expect(sameFormValues({ at: new Date(1) }, { at: new Date(2) })).toBe(false);
  });
});

describe("useUnsavedChanges", () => {
  let scope = effectScope();
  afterEach(() => scope.stop());

  const track = (read: () => unknown, active?: () => boolean) => {
    scope = effectScope();
    return scope.run(() => useUnsavedChanges(read, active))!;
  };

  it("keeps a value filled before the user acts as the baseline", async () => {
    const name = ref("");
    const { dirty } = track(() => name.value);
    name.value = "loaded";
    await nextTick();
    expect(dirty.value).toBe(false);
  });

  it("reports an edit after a keystroke and clears it when the value is put back", async () => {
    const name = ref("loaded");
    const { dirty } = track(() => name.value);
    press();
    name.value = "loadedx";
    expect(dirty.value).toBe(true);
    name.value = "loaded";
    expect(dirty.value).toBe(false);
  });

  it("does not take Escape or Tab as the user acting", () => {
    const name = ref("");
    const { dirty } = track(() => name.value);
    press("Escape");
    press("Tab");
    name.value = "loaded";
    expect(dirty.value).toBe(false);
  });

  it("sees an in-place edit of an object after a click", () => {
    const state = ref({ rules: [{ field: "a" }] });
    const { dirty } = track(() => state.value);
    click();
    state.value.rules[0].field = "b";
    expect(dirty.value).toBe(true);
  });

  it("starts clean each time the overlay opens", async () => {
    const open = ref(true);
    const name = ref("a");
    const { dirty } = track(
      () => name.value,
      () => open.value,
    );
    press();
    name.value = "b";
    expect(dirty.value).toBe(true);
    open.value = false;
    await nextTick();
    expect(dirty.value).toBe(false);
    open.value = true;
    await nextTick();
    name.value = "c";
    expect(dirty.value).toBe(false);
  });

  it("forgets the baseline on release and takes a new one on rebase", () => {
    const name = ref("a");
    const { dirty, release, rebase } = track(() => name.value);
    press();
    name.value = "b";
    release();
    name.value = "reseeded";
    expect(dirty.value).toBe(false);
    rebase();
    expect(dirty.value).toBe(false);
    name.value = "edited";
    expect(dirty.value).toBe(true);
  });
});
