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

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

import TraceTimestampCell from "./TraceTimestampCell.vue";

installQuasar();

describe("TraceTimestampCell", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    wrapper = mount(TraceTimestampCell, {
      props: { value: "2026-03-07 12:00:00" },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("rendering", () => {
    it("should render without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the timestamp container", () => {
      expect(
        wrapper.find('[data-test="trace-row-timestamp"]').exists(),
      ).toBe(true);
    });

    it("should render the timestamp span", () => {
      expect(
        wrapper.find('[data-test="trace-row-timestamp-day"]').exists(),
      ).toBe(true);
    });

    it("should display the value prop", () => {
      expect(
        wrapper.find('[data-test="trace-row-timestamp-day"]').text(),
      ).toBe("2026-03-07 12:00:00");
    });
  });

  describe("reactivity", () => {
    it("should update when value prop changes", async () => {
      await wrapper.setProps({ value: "2026-03-08 08:30:00" });
      expect(
        wrapper.find('[data-test="trace-row-timestamp-day"]').text(),
      ).toBe("2026-03-08 08:30:00");
    });
  });

  describe("edge cases", () => {
    it("should render an empty string without crashing", async () => {
      await wrapper.setProps({ value: "" });
      expect(wrapper.exists()).toBe(true);
    });
  });
});
