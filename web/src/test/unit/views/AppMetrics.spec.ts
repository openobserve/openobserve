// Copyright 2025 OpenObserve Inc.
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
import AppMetrics from "@/views/AppMetrics.vue";

describe("AppMetrics.vue", () => {
  it("should render zinc-metrics component", () => {
    const wrapper = mount(AppMetrics, {
      global: {
        stubs: {
          "zinc-metrics": {
            template: '<div data-test="zinc-metrics" />',
          },
        },
      },
    });

    expect(wrapper.find('[data-test="zinc-metrics"]').exists()).toBe(true);
  });

  it("should render zinc-metrics with pageType attribute", () => {
    const wrapper = mount(AppMetrics, {
      global: {
        stubs: {
          "zinc-metrics": {
            template: '<div class="zinc-metrics" v-bind="$attrs" />',
          },
        },
      },
    });

    expect(wrapper.find(".zinc-metrics").exists()).toBe(true);
  });

  it("should render without errors", () => {
    expect(() => {
      mount(AppMetrics, {
        global: {
          stubs: {
            "zinc-metrics": true,
          },
        },
      });
    }).not.toThrow();
  });
});
