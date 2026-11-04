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
import MetricsFailedLine from "./MetricsFailedLine.vue";

const SENTENCE = "Couldn't load: you don't have access to this data. Refresh to try again.";

const mountLine = (props: Record<string, unknown> = {}) =>
  mount(MetricsFailedLine, { props: { sentence: SENTENCE, dataTest: "line", ...props } });

describe("MetricsFailedLine", () => {
  it("draws the shared failed pill with the short Couldn't load words inside one alert", () => {
    const wrapper = mountLine();
    expect(wrapper.attributes("role")).toBe("alert");
    const pill = wrapper.findComponent({ name: "OFailedPill" });
    expect(pill.exists()).toBe(true);
    expect(pill.props()).toMatchObject({
      sentence: SENTENCE,
      marker: "Couldn't load",
      retry: true,
      dataTest: "line",
    });
    expect(wrapper.find('[data-test="line"]').classes()).toContain("bg-status-error-bg");
  });

  it("passes Retry off through to the pill and re-emits its Retry", async () => {
    expect(mountLine({ retry: false }).findComponent({ name: "OFailedPill" }).props("retry")).toBe(
      false,
    );
    const wrapper = mountLine();
    await wrapper.get('[data-test="line-retry"]').trigger("click");
    expect(wrapper.emitted("retry")).toEqual([[]]);
  });
});
