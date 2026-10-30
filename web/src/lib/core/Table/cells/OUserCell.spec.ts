// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OUserCell from "./OUserCell.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

describe("OUserCell", () => {
  it("cuts a plain identity with a cut-only tooltip and no always-on title", () => {
    const wrapper = mount(OUserCell, { props: { value: "ana.lopez@example.com" } });

    const text = wrapper.findComponent(OTruncatedText);
    expect(text.text()).toBe("ana.lopez@example.com");
    expect(text.attributes("title")).toBeUndefined();
  });

  it("keeps the full identity in the title when it shows a shorter name", () => {
    const wrapper = mount(OUserCell, {
      props: { value: "ana.lopez@example.com", localPart: true },
    });

    expect(wrapper.findComponent(OTruncatedText).exists()).toBe(false);
    const name = wrapper.find('span[title="ana.lopez@example.com"]');
    expect(name.text()).toBe("Ana Lopez");
    expect(name.classes()).toContain("truncate");
  });

  it("lets the cell shrink so a long identity cuts with an ellipsis", () => {
    const wrapper = mount(OUserCell, { props: { value: "ana@example.com" } });

    expect(wrapper.classes()).toEqual(expect.arrayContaining(["max-w-full", "min-w-0"]));
  });
});
