// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import OBanner from "./OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { BANNER_TONES } from "./OBanner.types";

const iconStub = { props: ["name"], template: '<i data-test="icon" :data-name="name" />' };
const stubs = { OIcon: iconStub };

const mountBanner = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
  mount(OBanner, { props, slots, global: { stubs } });

describe("OBanner", () => {
  it("is a full-width 36-high strip under the header: page gutter, bottom edge, no radius", () => {
    const root = mountBanner({ message: "Sampling is on." }).get('[role="status"]');
    expect(root.classes()).toEqual(
      expect.arrayContaining([
        "min-h-control-lg",
        "w-full",
        "border-b",
        "px-page-edge",
        "text-compact",
      ]),
    );
    expect(root.classes().some((c) => c.startsWith("rounded"))).toBe(false);
    expect(root.text()).toBe("Sampling is on.");
  });

  it("defaults to info and paints each tone with its soft triplet", () => {
    expect(mountBanner().attributes("data-tone")).toBe("info");
    const fills = {
      neutral: "bg-banner-default-bg",
      info: "bg-banner-info-bg",
      warn: "bg-banner-warning-bg",
      err: "bg-banner-error-soft-bg",
    } as const;
    for (const tone of BANNER_TONES) {
      const root = mountBanner({ tone });
      expect(root.classes()).toContain(fills[tone]);
    }
  });

  it("never paints a solid red fill for an error", () => {
    const classes = mountBanner({ tone: "err" }).classes();
    expect(classes).not.toContain("bg-banner-error-bg");
    expect(classes).toContain("text-banner-error-soft-text");
  });

  it("derives the role from the tone: problems are alerts, the rest status", () => {
    expect(mountBanner({ tone: "err" }).attributes("role")).toBe("alert");
    expect(mountBanner({ tone: "warn" }).attributes("role")).toBe("alert");
    expect(mountBanner({ tone: "info" }).attributes("role")).toBe("status");
    expect(mountBanner({ tone: "neutral" }).attributes("role")).toBe("status");
  });

  it("shows the tone glyph unless an icon names the condition", () => {
    expect(mountBanner({ tone: "warn" }).get('[data-test="icon"]').attributes("data-name")).toBe(
      "warning",
    );
    expect(
      mountBanner({ tone: "warn", icon: "lock" }).get('[data-test="icon"]').attributes("data-name"),
    ).toBe("lock");
  });

  it("lets the default slot replace the message", () => {
    const wrapper = mountBanner({ message: "plain" }, { default: "<b>rich</b> text" });
    expect(wrapper.get('[data-test="o-banner-message"]').html()).toContain("<b>rich</b>");
    expect(wrapper.text()).not.toContain("plain");
  });

  it("renders one small action from actionLabel and emits action", async () => {
    const wrapper = mountBanner({ actionLabel: "View usage", actionDataTest: "usage" });
    const button = wrapper.getComponent(OButton);
    expect(button.props("variant")).toBe("secondary");
    expect(wrapper.get('[data-test="usage"]').text()).toBe("View usage");
    await wrapper.get('[data-test="usage"]').trigger("click");
    expect(wrapper.emitted("action")).toHaveLength(1);
  });

  it("sizes a slotted action to the small height without the caller saying so", () => {
    const wrapper = mount(OBanner, {
      slots: { actions: '<OButton data-test="slotted">Retry</OButton>' },
      global: { stubs, components: { OButton } },
    });
    expect(wrapper.get('[data-test="slotted"]').classes()).toContain("h-control-sm");
  });

  it("has no action area and no dismiss by default", () => {
    const wrapper = mountBanner({ message: "m" });
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("dismisses through a named close button that follows the banner's data-test", async () => {
    const wrapper = mount(OBanner, {
      props: { dismissible: true },
      attrs: { "data-test": "quota" },
      global: { stubs },
    });
    const close = wrapper.get('[data-test="quota-dismiss"]');
    await close.trigger("click");
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
    expect(mountBanner({ dismissible: true }).find('[data-test="o-banner-dismiss"]').exists()).toBe(
      true,
    );
  });
});
