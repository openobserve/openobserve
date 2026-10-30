import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ODescriptionList from "./ODescriptionList.vue";
import ODescriptionItem from "./ODescriptionItem.vue";
import { raw } from "@/types/i18n";

describe("ODescriptionList", () => {
  it("renders a real <dl>", () => {
    const w = mount(ODescriptionList);
    expect(w.element.tagName).toBe("DL");
  });

  it.each([
    [1, false],
    [2, true],
  ] as const)("columns=%s adds the md two-column class: %s", (columns, expected) => {
    const w = mount(ODescriptionList, { props: { columns } });
    expect(w.classes().includes("md:grid-cols-2")).toBe(expected);
  });

  it("switches row rhythm on dense", () => {
    expect(mount(ODescriptionList).classes()).toContain("gap-y-3");
    expect(mount(ODescriptionList, { props: { dense: true } }).classes()).toContain("gap-y-1.5");
  });
});

describe("ODescriptionItem", () => {
  it("pairs the label and the value as <dt>/<dd>", () => {
    const w = mount(ODescriptionItem, {
      props: { label: raw("Team") },
      slots: { default: "Platform" },
    });
    expect(w.find("dt").text()).toBe("Team");
    expect(w.find("dd").text()).toBe("Platform");
  });

  // An absent value must read as absent, not as a blank row the eye skips.
  it.each([
    [undefined, "—"],
    [raw("not set"), "not set"],
  ])("falls back to emptyLabel %s when the slot is empty", (emptyLabel, expected) => {
    const w = mount(ODescriptionItem, {
      props: emptyLabel ? { label: raw("Team"), emptyLabel } : { label: raw("Team") },
    });
    expect(w.find("dd").text()).toBe(expected);
  });

  it.each([
    [false, "grid-cols-[10rem_1fr]"],
    [true, "flex-col"],
  ])("stacked=%s picks its layout", (stacked, expected) => {
    const w = mount(ODescriptionItem, { props: { label: raw("Team"), stacked } });
    expect(w.classes().join(" ")).toContain(expected);
  });

  it("lets the label be replaced by a slot", () => {
    const w = mount(ODescriptionItem, {
      props: { label: raw("Team") },
      slots: { label: "<span>Owning team</span>" },
    });
    expect(w.find("dt").text()).toBe("Owning team");
  });

  it("groups pairs so a two-column list keeps each value beside its own label", () => {
    const w = mount(ODescriptionList, {
      props: { columns: 2 },
      slots: {
        default: `<div data-test="o2-description-item"><dt>a</dt><dd>1</dd></div>`,
      },
    });
    expect(w.findAll("dl > [data-test='o2-description-item']")).toHaveLength(1);
  });
});
