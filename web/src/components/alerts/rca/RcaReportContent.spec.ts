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
import RcaReportContent from "./RcaReportContent.vue";
import { renderRcaReport } from "@/utils/incidents/rcaReportMarkdown";

describe("RcaReportContent", () => {
  it("renders the given report HTML", () => {
    const wrapper = mount(RcaReportContent, {
      props: {
        html: renderRcaReport("## Root Cause\n\n`kubectl logs <pod-name>`"),
        isDarkMode: false,
      },
    });

    const root = wrapper.find('[data-test="rca-report-content"]');
    expect(root.find(".rca-report-content").exists()).toBe(true);
    expect(root.find(".rca-h2").text()).toBe("Root Cause");
    expect(root.find("code").text()).toBe("kubectl logs <pod-name>");
    expect(root.classes()).not.toContain("rca-content--dark");
  });

  it("marks dark mode on its root", () => {
    const wrapper = mount(RcaReportContent, { props: { html: "<p>x</p>", isDarkMode: true } });

    expect(wrapper.find('[data-test="rca-report-content"]').classes()).toContain(
      "rca-content--dark",
    );
  });
});
