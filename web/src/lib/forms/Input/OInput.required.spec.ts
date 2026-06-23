// Regression: `required` renders a `*` after the label (so forms stop
// hardcoding `label + ' *'`).
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OInput from "./OInput.vue";
import OTextarea from "./OTextarea.vue";

describe("required → auto asterisk", () => {
  it("OInput shows * after the label when required", () => {
    const w = mount(OInput, { props: { label: "Name", required: true } });
    const label = w.find("label").text();
    expect(label).toContain("Name");
    expect(label).toContain("*");
  });

  it("OInput shows no * when not required", () => {
    const w = mount(OInput, { props: { label: "Name" } });
    expect(w.find("label").text()).not.toContain("*");
  });

  it("OTextarea shows * after the label when required", () => {
    const w = mount(OTextarea, { props: { label: "Desc", required: true } });
    expect(w.find("label").text()).toContain("*");
  });
});
