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

import AssistantCapabilities from "./AssistantCapabilities.vue";

const mountPage = () => mount(AssistantCapabilities, { global: { plugins: [i18n] } });

describe("AssistantCapabilities", () => {
  it("draws six slides with lazy, described GIFs and one primary button", () => {
    const wrapper = mountPage();
    expect(wrapper.findAll('[data-test="assistant-capabilities-slide"]')).toHaveLength(6);
    const imgs = wrapper.findAll("img");
    expect(imgs).toHaveLength(6);
    expect(wrapper.findAll('[data-test="assistant-capabilities-try"]')).toHaveLength(1);
    imgs.forEach((img) => {
      expect(img.attributes("loading")).toBe("lazy");
      expect(img.attributes("alt")).toBeTruthy();
    });
  });

  it("emits back, and try with the sample question from the last slide", async () => {
    const wrapper = mountPage();
    await wrapper.get('[data-test="assistant-capabilities-back"]').trigger("click");
    expect(wrapper.emitted("back")).toHaveLength(1);
    await wrapper.get('[data-test="assistant-capabilities-try"]').trigger("click");
    expect(wrapper.emitted("try")?.[0]).toEqual(["Why is checkout-api failing?"]);
  });
});
