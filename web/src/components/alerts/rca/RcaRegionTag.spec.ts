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
import i18n from "@/locales";
import RcaRegionTag from "./RcaRegionTag.vue";

const mountTag = (props: Record<string, unknown>) =>
  mount(RcaRegionTag, { props, global: { plugins: [i18n] } });

describe("RcaRegionTag (U8)", () => {
  it.each([
    ["terminal", "us-east-1", "Analyzed in us-east-1", "known"],
    ["live", "us-east-1", "Analyzing in us-east-1", "known"],
    ["terminal", null, "analysis region unknown", "unknown"],
    ["terminal", "", "analysis region unknown", "unknown"],
    ["live", "  ", "analysis region unknown", "unknown"],
    ["none", "us-east-1", "no local analysis; other regions unknown", "none"],
  ])("state %s with region %j reads %j", (state, region, label, regionState) => {
    const tag = mountTag({ state, region }).find('[data-test="rca-analysis-region"]');

    expect(tag.text()).toBe(label);
    expect(tag.attributes("data-region-state")).toBe(regionState);
  });

  it("only a known region carries the globe icon", () => {
    expect(mountTag({ state: "terminal", region: "us-east-1" }).find("svg").exists()).toBe(true);
    expect(mountTag({ state: "terminal", region: null }).find("svg").exists()).toBe(false);
    expect(mountTag({ state: "none" }).find("svg").exists()).toBe(false);
  });

  it("renders a skeleton, never a label, while loading", () => {
    const wrapper = mountTag({ state: "terminal", region: "us-east-1", loading: true });

    expect(wrapper.find('[data-test="rca-analysis-region-loading"]').exists()).toBe(true);
    expect(wrapper.text()).toBe("");
  });

  it("uses the caller's data-test", () => {
    const wrapper = mountTag({
      state: "terminal",
      region: "eu-1",
      dataTest: "rca-history-item-2-region",
    });

    expect(wrapper.find('[data-test="rca-history-item-2-region"]').text()).toBe("Analyzed in eu-1");
  });
});
