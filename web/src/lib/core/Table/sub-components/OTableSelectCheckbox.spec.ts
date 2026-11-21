// Copyright 2026 OpenObserve Inc.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { computed, ref } from "vue";
import OTableSelectCheckbox from "./OTableSelectCheckbox.vue";
import { OTableFocusToolbarKey, type OTableFocusToolbarContext } from "../OTable.types";

const focusCtx: OTableFocusToolbarContext = {
  enabled: computed(() => true),
  current: ref<string | null>(null),
  fallback: ref<string | null>(null),
  refresh: () => {},
  positionOf: () => undefined,
};

const ariaLabel = (props: Record<string, unknown>) =>
  mount(OTableSelectCheckbox, {
    props: { modelValue: false, ...props },
    global: { provide: { [OTableFocusToolbarKey as symbol]: focusCtx } },
  })
    .find('button[role="checkbox"]')
    .attributes("aria-label");

describe("OTableSelectCheckbox focus-toolbar names", () => {
  it("names an unlabelled row checkbox by its display position", () => {
    expect(ariaLabel({ rowId: "4", position: 2 })).toBe("Select row 3");
  });

  it("names the header checkbox as select all", () => {
    expect(ariaLabel({ rowId: "all" })).toBe("Select all rows");
  });
});
