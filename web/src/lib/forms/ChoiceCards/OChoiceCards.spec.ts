// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { raw } from "@/types/i18n";
import OChoiceCards from "./OChoiceCards.vue";

const options = [
  { value: "a", label: raw("First"), description: raw("About first"), dataTest: "card-a" },
  { value: "b", label: raw("Second"), dataTest: "card-b" },
];

const mountCards = (props = {}) =>
  mount(OChoiceCards, { props: { options, label: raw("Pick"), modelValue: "a", ...props } });

describe("OChoiceCards", () => {
  it("shows each choice with its description, marking the picked one", () => {
    const wrapper = mountCards();
    expect(wrapper.get('[data-test="card-a"]').text()).toContain("About first");
    expect(wrapper.get('[data-test="card-a"]').attributes("data-state")).toBe("checked");
    expect(wrapper.get('[data-test="card-b"]').attributes("data-state")).toBe("unchecked");
  });

  it("emits the value of the card clicked", async () => {
    const wrapper = mountCards();
    await wrapper.get('[data-test="card-b"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["b"]);
  });

  it("emits nothing while disabled", async () => {
    const wrapper = mountCards({ disabled: true });
    await wrapper.get('[data-test="card-b"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });
});
