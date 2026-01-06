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
import AppTraces from "@/views/AppTraces.vue";

describe("AppTraces.vue", () => {
  it("should render zinc-traces component", () => {
    const wrapper = mount(AppTraces, {
      global: {
        stubs: {
          "zinc-traces": {
            template: '<div class="zinc-traces" />',
          },
        },
      },
    });

    expect(wrapper.find(".zinc-traces").exists()).toBe(true);
  });

  it("should render zinc-traces component with data attribute", () => {
    const wrapper = mount(AppTraces, {
      global: {
        stubs: {
          "zinc-traces": {
            template: '<div data-test="zinc-traces-component"><slot /></div>',
          },
        },
      },
    });

    expect(wrapper.find('[data-test="zinc-traces-component"]').exists()).toBe(true);
  });

  it("should render without errors", () => {
    expect(() => {
      mount(AppTraces, {
        global: {
          stubs: {
            "zinc-traces": true,
          },
        },
      });
    }).not.toThrow();
  });

  it("should mount successfully", () => {
    const wrapper = mount(AppTraces, {
      global: {
        stubs: {
          "zinc-traces": true,
        },
      },
    });

    expect(wrapper.exists()).toBe(true);
  });
});
