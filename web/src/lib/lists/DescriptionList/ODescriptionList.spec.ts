import { describe, it, expect } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import ODescriptionList from "./ODescriptionList.vue";
import ODescriptionItem from "./ODescriptionItem.vue";
import { raw } from "@/types/i18n";

describe("ODescriptionList", () => {
  it("renders a real <dl> inside its container", () => {
    const w = mount(ODescriptionList);
    expect(w.find("dl[data-test='o2-description-list']").exists()).toBe(true);
  });

  it.each([
    ["columns", "grid-cols-[10rem_minmax(0,1fr)]"],
    ["stacked", "grid-cols-1"],
    ["auto", "@max-[30rem]/dl:grid-cols-1"],
  ] as const)("layout=%s picks its grid", (layout, expected) => {
    const w = mount(ODescriptionList, { props: { layout } });
    expect(w.find("dl").classes()).toContain(expected);
  });

  it("renders items from data, with a muted dash for a missing value", () => {
    const w = mount(ODescriptionList, {
      props: {
        items: [
          { label: raw("Owner"), value: "priya" },
          { label: raw("Description"), value: null },
        ],
      },
    });
    const values = w.findAll("dd");
    expect(values[0].text()).toBe("priya");
    expect(values[1].text()).toBe("—");
    expect(values[1].find("[data-test='o2-description-empty']").classes()).toContain(
      "text-text-muted",
    );
  });

  it("uses mono keys and values for labels='mono' (T4)", () => {
    const w = mount(ODescriptionList, {
      props: { labels: "mono", items: [{ label: raw("k8s.pod.name"), value: "api-7c9f" }] },
    });
    expect(w.find("dt").classes()).toContain("font-mono");
    expect(w.find("dd").classes()).toContain("font-mono");
  });

  it("keeps sans text for labels='text' and lets one value go mono", () => {
    const w = mount(ODescriptionList, {
      props: {
        items: [
          { label: raw("Owner"), value: "priya" },
          { label: raw("Trace"), value: "4bf92f", mono: true },
        ],
      },
    });
    const [owner, trace] = w.findAll("dd");
    expect(w.find("dt").classes()).toContain("text-compact");
    expect(owner.classes()).not.toContain("font-mono");
    expect(trace.classes()).toContain("font-mono");
  });

  it("offers copy on hover only for a present value", () => {
    const w = mount(ODescriptionList, {
      props: {
        items: [
          { label: raw("Trace"), value: "4bf92f", copy: true },
          { label: raw("Span"), value: null, copy: true },
        ],
      },
    });
    expect(w.findAll("[data-test='o2-description-copy']")).toHaveLength(1);
  });

  it("applies the list's empty label to child items", () => {
    const w = mount(ODescriptionList, {
      props: { emptyLabel: raw("not set") },
      slots: { default: () => h(ODescriptionItem, { label: raw("Team") }) },
    });
    expect(w.find("dd").text()).toBe("not set");
  });
});

describe("ODescriptionItem", () => {
  it("pairs the label and the value as <dt>/<dd> in one subgrid row", () => {
    const w = mount(ODescriptionItem, {
      props: { label: raw("Team") },
      slots: { default: "Platform" },
    });
    expect(w.classes()).toContain("grid-cols-subgrid");
    expect(w.find("dt").text()).toBe("Team");
    expect(w.find("dd").text()).toBe("Platform");
  });

  it.each([
    [undefined, "—"],
    [raw("not set"), "not set"],
  ])("falls back to emptyLabel %s when there is no value", (emptyLabel, expected) => {
    const w = mount(ODescriptionItem, {
      props: emptyLabel ? { label: raw("Team"), emptyLabel } : { label: raw("Team") },
    });
    expect(w.find("dd").text()).toBe(expected);
  });

  it("shows a real zero, not the empty dash", () => {
    const w = mount(ODescriptionItem, { props: { label: raw("Retries"), value: 0 } });
    expect(w.find("dd").text()).toBe("0");
  });

  it("lets the label be replaced by a slot", () => {
    const w = mount(ODescriptionItem, {
      props: { label: raw("Team") },
      slots: { label: "<span>Owning team</span>" },
    });
    expect(w.find("dt").text()).toBe("Owning team");
  });
});
