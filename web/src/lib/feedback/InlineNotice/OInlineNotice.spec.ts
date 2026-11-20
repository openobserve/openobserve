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
import OInlineNotice from "./OInlineNotice.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { INLINE_NOTICE_TONES } from "./OInlineNotice.types";

const iconStub = { props: ["name"], template: '<i data-test="icon" :data-name="name" />' };
const stubs = { OIcon: iconStub };

const mountNotice = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
  mount(OInlineNotice, { props, slots, global: { stubs } });

describe("OInlineNotice", () => {
  it("is a rounded box with a 1 px edge that wraps its 13 px text", () => {
    const root = mountNotice({ message: "Fields with no events in 30 days are hidden." });
    expect(root.classes()).toEqual(
      expect.arrayContaining(["rounded-default", "border", "px-3", "py-2", "text-compact"]),
    );
    expect(root.find(".truncate").exists()).toBe(false);
    expect(root.text()).toBe("Fields with no events in 30 days are hidden.");
  });

  it("defaults to info and paints each of its five tones", () => {
    expect(mountNotice().attributes("data-tone")).toBe("info");
    const fills = {
      neutral: "bg-banner-default-bg",
      info: "bg-banner-info-bg",
      warn: "bg-banner-warning-bg",
      err: "bg-banner-error-soft-bg",
      ok: "bg-banner-success-bg",
    } as const;
    for (const tone of INLINE_NOTICE_TONES) {
      expect(mountNotice({ tone }).classes()).toContain(fills[tone]);
    }
  });

  it("is an alert for err and warn, a status otherwise", () => {
    expect(mountNotice({ tone: "err" }).attributes("role")).toBe("alert");
    expect(mountNotice({ tone: "warn" }).attributes("role")).toBe("alert");
    expect(mountNotice({ tone: "ok" }).attributes("role")).toBe("status");
    expect(mountNotice({ tone: "neutral" }).attributes("role")).toBe("status");
  });

  it("top-aligns the tone glyph, or a glyph that names the condition", () => {
    const icon = mountNotice({ tone: "ok" }).get('[data-test="icon"]');
    expect(icon.attributes("data-name")).toBe("check-circle");
    expect(icon.classes()).toContain("mt-0.5");
    expect(mountNotice({ icon: "history" }).get('[data-test="icon"]').attributes("data-name")).toBe(
      "history",
    );
  });

  it("lets the default slot replace the message", () => {
    const wrapper = mountNotice({ message: "plain" }, { default: "<code>line 4</code>" });
    expect(wrapper.get('[data-test="o-inline-notice-message"]').html()).toContain("<code>");
    expect(wrapper.text()).not.toContain("plain");
  });

  it("sizes its secondary action to the small control height", () => {
    const wrapper = mountNotice({ actionLabel: "Retry", actionDataTest: "retry" });
    expect(wrapper.getComponent(OButton).props("variant")).toBe("secondary");
    expect(wrapper.get('[data-test="retry"]').classes()).toContain("h-control-sm");
  });

  it("renders no action without a label or slot", () => {
    expect(mountNotice({ message: "Nothing here." }).find("button").exists()).toBe(false);
  });

  it("emits action from one small end-aligned button", async () => {
    const wrapper = mountNotice({
      message: "Nothing here.",
      actionLabel: "Open Logs tab",
      actionVariant: "link",
      actionDataTest: "open",
    });
    const button = wrapper.getComponent(OButton);
    expect(button.props("variant")).toBe("link");
    expect(wrapper.get('[data-test="open"]').element.parentElement?.classList).toContain("ms-auto");
    await wrapper.get('[data-test="open"]').trigger("click");
    expect(wrapper.emitted("action")).toHaveLength(1);
  });
});
