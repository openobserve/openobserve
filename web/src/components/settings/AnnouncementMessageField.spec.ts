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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import i18n from "@/locales";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import AnnouncementMessageField from "./AnnouncementMessageField.vue";

installQuasar();

function mountField(modelValue: string) {
  return mount(AnnouncementMessageField, {
    props: { modelValue },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
}

describe("AnnouncementMessageField", () => {
  it("wraps the selected text when a toolbar button is pressed", async () => {
    const wrapper = mountField("make this loud");
    const textarea = wrapper.get("textarea").element as HTMLTextAreaElement;
    textarea.setSelectionRange(5, 9);

    await wrapper.get('[data-test="announcement-editor-format-bold"]').trigger("click");
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["make **this** loud"]);
    wrapper.unmount();
  });

  it("turns the selection into a link", async () => {
    const wrapper = mountField("see docs");
    (wrapper.get("textarea").element as HTMLTextAreaElement).setSelectionRange(4, 8);

    await wrapper.get('[data-test="announcement-editor-format-link"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["see [docs](https://)"]);
    wrapper.unmount();
  });

  it("counts characters and warns past the soft limit without blocking", async () => {
    const wrapper = mountField("x".repeat(301));

    expect(wrapper.get('[data-test="announcement-editor-message-count"]').text()).toBe("301 / 300");
    expect(wrapper.find('[data-test="announcement-editor-message-long"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("gives every toolbar control a data-test id", () => {
    const wrapper = mountField("");

    for (const action of ["bold", "italic", "code", "link", "emoji"]) {
      expect(wrapper.find(`[data-test="announcement-editor-format-${action}"]`).exists()).toBe(
        true,
      );
    }
    wrapper.unmount();
  });
});
