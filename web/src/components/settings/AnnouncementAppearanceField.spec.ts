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
import { describe, expect, it } from "vitest";

import i18n from "@/locales";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import AnnouncementAppearanceField from "./AnnouncementAppearanceField.vue";

installQuasar();

function mountField(colorLight = "", colorDark = "") {
  return mount(AnnouncementAppearanceField, {
    props: { textSize: "medium", colorLight, colorDark, errors: {} },
    global: { plugins: [i18n] },
  });
}

const selected = (wrapper: ReturnType<typeof mountField>) =>
  wrapper.findAll(".announcement-swatch.is-selected").map((node) => node.attributes("data-test"));

describe("AnnouncementAppearanceField", () => {
  it("starts on Severity default when no colour is stored", () => {
    expect(selected(mountField())).toEqual(["announcement-editor-color-default"]);
  });

  it("reopens a stored preset pair on its swatch", () => {
    expect(selected(mountField("#dbeafe", "#1E3A8A"))).toEqual(["announcement-editor-color-blue"]);
  });

  it("reopens any other pair as Custom with both pickers", () => {
    const wrapper = mountField("#123456", "");

    expect(selected(wrapper)).toEqual(["announcement-editor-color-custom"]);
    expect(wrapper.find('[data-test="announcement-editor-colorLight-picker"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="announcement-editor-colorDark-picker"]').exists()).toBe(true);
  });

  it("writes a preset's light and dark pair, and clears both for Match severity", async () => {
    const wrapper = mountField();

    await wrapper.get('[data-test="announcement-editor-color-slate"]').trigger("click");
    expect(wrapper.emitted("update:colorLight")?.at(-1)).toEqual(["#1E293B"]);
    expect(wrapper.emitted("update:colorDark")?.at(-1)).toEqual(["#E2E8F0"]);

    await wrapper.get('[data-test="announcement-editor-color-default"]').trigger("click");
    expect(wrapper.emitted("update:colorLight")?.at(-1)).toEqual([""]);
    expect(wrapper.emitted("update:colorDark")?.at(-1)).toEqual([""]);
  });

  it("offers all nine presets", () => {
    const wrapper = mountField();

    for (const key of [
      "blue",
      "indigo",
      "teal",
      "green",
      "amber",
      "red",
      "purple",
      "slate",
      "brand",
    ]) {
      expect(wrapper.find(`[data-test="announcement-editor-color-${key}"]`).exists()).toBe(true);
    }
  });

  it("is one Tab stop that arrow keys move through, and Enter selects", async () => {
    const wrapper = mount(AnnouncementAppearanceField, {
      props: { textSize: "medium", colorLight: "", colorDark: "", errors: {} },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    const tabStops = () =>
      wrapper.findAll('[role="radio"]').filter((node) => node.attributes("tabindex") === "0");

    expect(tabStops().map((node) => node.attributes("data-test"))).toEqual([
      "announcement-editor-color-default",
    ]);

    const group = wrapper.get('[role="radiogroup"]');
    await group.trigger("keydown", { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("data-test")).toBe(
      "announcement-editor-color-blue",
    );
    expect(tabStops().map((node) => node.attributes("data-test"))).toEqual([
      "announcement-editor-color-blue",
    ]);

    await group.trigger("keydown", { key: "ArrowLeft" });
    await group.trigger("keydown", { key: "ArrowLeft" });
    expect(document.activeElement?.getAttribute("data-test")).toBe(
      "announcement-editor-color-custom",
    );

    await group.trigger("keydown", { key: "Home" });
    await group.trigger("keydown", { key: "ArrowRight" });
    (document.activeElement as HTMLButtonElement).click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("update:colorLight")?.at(-1)).toEqual(["#DBEAFE"]);
    expect(
      wrapper.get('[data-test="announcement-editor-color-blue"]').attributes("aria-checked"),
    ).toBe("true");
    wrapper.unmount();
  });
});
