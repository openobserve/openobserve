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

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import { raw } from "@/types/i18n";

import ONoticeBar from "./ONoticeBar.vue";
import type { Notice } from "./ONoticeBar.types";

const notice = (key: string, tone: Notice["tone"], over: Partial<Notice> = {}): Notice => ({
  key,
  tone,
  text: raw(`${key} text`),
  dataTest: `notice-${key}`,
  ...over,
});

const render = (notices: Notice[], props: Record<string, unknown> = {}) =>
  mount(ONoticeBar, { props: { notices, ...props }, global: { plugins: [i18n] } });

describe("ONoticeBar", () => {
  it("renders nothing without notices", () => {
    expect(render([]).find('[role="status"]').exists()).toBe(false);
  });

  it("leads with the most severe notice and keeps input order inside a tone", async () => {
    const wrapper = render([
      notice("info", "info"),
      notice("warnA", "warning"),
      notice("error", "error"),
      notice("warnB", "warning"),
    ]);
    expect(wrapper.find('[data-test="notice-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="notice-warnA"]').exists()).toBe(false);
    await wrapper.get('[data-test="o-notice-bar-toggle"]').trigger("click");
    const order = wrapper
      .findAll("[data-test^='notice-']")
      .map((node) => node.attributes("data-test"));
    expect(order).toEqual(["notice-error", "notice-warnA", "notice-warnB", "notice-info"]);
  });

  it("counts the hidden notices on the toggle and reads Show less once open", async () => {
    const wrapper = render([notice("a", "warning"), notice("b", "info"), notice("c", "info")]);
    const toggle = wrapper.get('[data-test="o-notice-bar-toggle"]');
    expect(toggle.text()).toBe("2 more");
    await toggle.trigger("click");
    expect(toggle.text()).toBe("Show less");
  });

  it("has no toggle for one short notice, and Read more for one long notice", () => {
    expect(
      render([notice("a", "info")])
        .find('[data-test="o-notice-bar-toggle"]')
        .exists(),
    ).toBe(false);
    const long = notice("long", "info", { text: raw("x".repeat(120)) });
    expect(render([long]).get('[data-test="o-notice-bar-toggle"]').text()).toBe("Read more");
  });

  it("runs a notice's own action", async () => {
    const onAction = vi.fn();
    const wrapper = render([notice("a", "error", { actionLabel: raw("Retry"), onAction })]);
    await wrapper.get('[data-test="notice-a-action"]').trigger("click");
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("takes the caller's toggle data-test", () => {
    const wrapper = render([notice("a", "info"), notice("b", "info")], {
      toggleDataTest: "security-notices-toggle",
    });
    expect(wrapper.find('[data-test="security-notices-toggle"]').exists()).toBe(true);
  });
});
