// Copyright 2026 OpenObserve Inc.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OAvatar from "@/lib/core/Avatar/OAvatar.vue";

describe("OAvatar", () => {
  it("takes one letter from each of the first two words of a name", () => {
    expect(mount(OAvatar, { props: { value: "mei@o2.ai", name: "Mei Tanaka" } }).text()).toBe("MT");
  });

  /// `.`, `_` and `-` are word breaks, so an address reads as a person rather
  /// than as its first two characters.
  it("reads word breaks inside an email local part", () => {
    expect(mount(OAvatar, { props: { value: "mei.tanaka@o2.ai" } }).text()).toBe("MT");
    expect(mount(OAvatar, { props: { value: "ana@o2.ai" } }).text()).toBe("AN");
  });

  it("renders nothing rather than a stray glyph when there is no identity", () => {
    expect(mount(OAvatar, { props: { value: "" } }).text()).toBe("");
  });

  /// The tone is derived, so the same person is the same colour on every
  /// screen without a colour being threaded through.
  it("gives one identity the same tone every time, and different ones different tones", () => {
    const tone = (value: string) =>
      mount(OAvatar, { props: { value } })
        .classes()
        .find((c) => c.startsWith("bg-badge-"));

    expect(tone("ana@o2.ai")).toBe(tone("ana@o2.ai"));
    expect(tone("ana@o2.ai")).not.toBe(tone("bob@o2.ai"));
  });

  it("carries the full identity for hover and screen readers", () => {
    const wrapper = mount(OAvatar, { props: { value: "ana@o2.ai" } });
    expect(wrapper.attributes("title")).toBe("ana@o2.ai");
    expect(wrapper.attributes("aria-label")).toBe("ana@o2.ai");
  });
});
