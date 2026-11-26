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

import AssistantTitleEdit from "./AssistantTitleEdit.vue";

async function editing() {
  const wrapper = mount(AssistantTitleEdit, {
    props: { title: "Checkout errors" },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  await wrapper.get('[data-test="assistant-thread-heading-edit-trigger"]').trigger("click");
  await flushPromises();
  const input = wrapper.get('[data-test="assistant-thread-heading-edit-input"]');
  await input.setValue("チェック");
  return { wrapper, input };
}

describe("AssistantTitleEdit", () => {
  it("does not commit on the Enter that confirms an IME composition", async () => {
    const { wrapper, input } = await editing();
    await input.trigger("keydown", { key: "Enter", isComposing: true });
    await input.trigger("keydown", { key: "Enter", keyCode: 229 });
    expect(wrapper.emitted("commit")).toBeUndefined();
    expect(wrapper.find('[data-test="assistant-thread-heading-edit-input"]').exists()).toBe(true);
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("commit")).toEqual([["チェック"]]);
    wrapper.unmount();
  });
});
