// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach } from "vitest";
import { nextTick, ref } from "vue";
import { useAutoName } from "./useAutoName";

/** A field the composable writes into, standing in for a form value. */
const makeField = (initial = "") => {
  const value = ref(initial);
  return {
    value,
    currentValue: () => value.value,
    apply: (name: string) => {
      value.value = name;
    },
  };
};

describe("useAutoName", () => {
  let suggestion: ReturnType<typeof ref<string>>;

  beforeEach(() => {
    suggestion = ref("Record count");
  });

  it("fills an empty field with the suggestion immediately", () => {
    const field = makeField();

    const auto = useAutoName({ suggestion: suggestion as any, ...field });

    expect(field.value.value).toBe("Record count");
    expect(auto.isAuto.value).toBe(true);
  });

  it("keeps tracking the suggestion while the name is still auto", async () => {
    const field = makeField();
    useAutoName({ suggestion: suggestion as any, ...field });

    suggestion.value = "Avg of duration by service";
    await nextTick();

    expect(field.value.value).toBe("Avg of duration by service");
  });

  it("never claims a field that already has a value", () => {
    const field = makeField("My saved panel");

    const auto = useAutoName({ suggestion: suggestion as any, ...field });

    expect(field.value.value).toBe("My saved panel");
    expect(auto.isAuto.value).toBe(false);
  });

  it("stops tracking the moment the user types", async () => {
    const field = makeField();
    const auto = useAutoName({ suggestion: suggestion as any, ...field });

    auto.markManual();
    field.apply("Checkout errors");
    suggestion.value = "Avg of duration by service";
    await nextTick();

    expect(field.value.value).toBe("Checkout errors");
    expect(auto.isAuto.value).toBe(false);
  });

  it("re-arms when the user clears the field and commits", async () => {
    const field = makeField();
    const auto = useAutoName({ suggestion: suggestion as any, ...field });
    auto.markManual();
    field.apply("");

    auto.onCommit("");

    expect(auto.isAuto.value).toBe(true);
    expect(field.value.value).toBe("Record count");
  });

  it("re-syncs to the CURRENT suggestion on commit, not the one present when editing began", async () => {
    const field = makeField();
    const auto = useAutoName({ suggestion: suggestion as any, ...field });
    // User starts editing and clears; meanwhile the query changes and the
    // suggestion moves on underneath the open editor.
    auto.markManual();
    field.apply("");
    suggestion.value = "Avg of duration";
    await nextTick();

    auto.onCommit("");

    // Re-armed with the value the generator produces NOW, not the stale one.
    expect(field.value.value).toBe("Avg of duration");
    expect(auto.isAuto.value).toBe(true);
  });

  it("steps aside when the field is written externally after auto armed (never clobbers a human value)", async () => {
    const field = makeField();
    // Arms auto and writes "Record count"; lastApplied now tracks that.
    const auto = useAutoName({ suggestion: suggestion as any, ...field });

    // Something other than the generator sets the field — a late edit-mode
    // prefill / JSON import. auto must relinquish and never overwrite it.
    field.apply("Imported title");
    suggestion.value = "Avg of duration";
    await nextTick();

    expect(field.value.value).toBe("Imported title");
    expect(auto.isAuto.value).toBe(false);
  });

  it("does not re-fill mid-edit — only a commit re-arms", async () => {
    const field = makeField();
    const auto = useAutoName({ suggestion: suggestion as any, ...field });

    // User selects all and deletes, intending to retype.
    auto.markManual();
    field.apply("");
    suggestion.value = "Avg of duration";
    await nextTick();

    expect(field.value.value).toBe("");
  });

  it("stays out of the way entirely when disabled (edit mode)", async () => {
    const field = makeField("");
    const auto = useAutoName({
      suggestion: suggestion as any,
      ...field,
      enabled: () => false,
    });

    suggestion.value = "Avg of duration";
    await nextTick();

    expect(field.value.value).toBe("");
    expect(auto.isAuto.value).toBe(false);
  });

  it("clears a name it owns when the suggestion dries up", async () => {
    const field = makeField();
    useAutoName({ suggestion: suggestion as any, ...field });

    suggestion.value = "";
    await nextTick();

    expect(field.value.value).toBe("");
  });

  it("hands the name back to the generator on resetToAuto", () => {
    const field = makeField("Checkout errors");
    const auto = useAutoName({ suggestion: suggestion as any, ...field });

    auto.resetToAuto();

    expect(auto.isAuto.value).toBe(true);
    expect(field.value.value).toBe("Record count");
  });
});
