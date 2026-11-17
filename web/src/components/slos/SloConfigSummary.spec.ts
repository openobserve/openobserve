// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import SloConfigSummary from "./SloConfigSummary.vue";

describe("SloConfigSummary", () => {
  it("wraps a monospace value without breaking mid-word", () => {
    const wrapper = mount(SloConfigSummary, {
      props: {
        slo: {
          sli_type: "request_based",
          target: 99.9,
          window_secs: 2_592_000,
          slice_interval_secs: 300,
          group_by: ["service_name", "http_route"],
        } as any,
      },
      global: { plugins: [i18n], stubs: { OCodeBlock: true } },
    });
    const mono = wrapper.findAll("dd").filter((dd) => dd.classes().includes("font-mono"));
    expect(mono.length).toBeGreaterThan(0);
    for (const dd of mono) {
      expect(dd.classes()).not.toContain("break-all");
      expect(dd.classes()).toEqual(
        expect.arrayContaining(["whitespace-pre-wrap", "[overflow-wrap:anywhere]"]),
      );
      expect(dd.element.textContent).toBe("service_name, http_route");
    }
  });
});
