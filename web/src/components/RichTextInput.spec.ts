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

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import RichTextInput from "./RichTextInput.vue";

const chip = (id: string) => ({
  id,
  filename: `Analysis · ${id}`,
  preview: `Analysis · ${id}`,
  fullContent: `Read-only copy of incident analysis ${id}`,
  charCount: 40,
  type: "context",
});

describe("RichTextInput chip detail card", () => {
  let wrapper: VueWrapper<any> | undefined;
  afterEach(() => {
    wrapper?.unmount();
    // insertChip places a chip at the document selection; one left by an earlier test misplaces it.
    window.getSelection()?.removeAllRanges();
  });

  const openCardOf = async (chipIds: string[], openId: string) => {
    wrapper = mount(RichTextInput, {
      props: { modelValue: "" },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    await flushPromises();
    for (const id of chipIds) wrapper.vm.insertChip(chip(id));
    await flushPromises();
    document.querySelector<HTMLElement>(`[data-chip-id="${openId}"]`)?.click();
    await flushPromises();
    expect(document.querySelector(".chip-detail-card")).not.toBeNull();
    return wrapper;
  };

  it("closes when the composer is cleared, as sending a message does", async () => {
    const input = await openCardOf(["c1"], "c1");
    input.vm.clear();
    await flushPromises();
    expect(document.querySelector(".reference-chip")).toBeNull();
    expect(document.querySelector(".chip-detail-card")).toBeNull();
  });

  it("closes when its chip is removed, and stays open when another chip is", async () => {
    const input = await openCardOf(["c1", "c2"], "c1");
    input.vm.removeChip("c2");
    await flushPromises();
    expect(document.querySelector(".chip-detail-card")).not.toBeNull();
    input.vm.removeChip("c1");
    await flushPromises();
    expect(document.querySelector(".chip-detail-card")).toBeNull();
  });
});
