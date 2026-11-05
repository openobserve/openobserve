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
import { defineComponent } from "vue";
import i18n from "@/locales";
import { useOverviewTime } from "./useOverviewTime";

const time = () => {
  let api!: ReturnType<typeof useOverviewTime>;
  mount(
    defineComponent({
      setup() {
        api = useOverviewTime();
        return () => null;
      },
    }),
    { global: { plugins: [i18n] } },
  );
  return api;
};

describe("useOverviewTime", () => {
  it("formats elapsed time with the two largest units", () => {
    const { formatElapsed } = time();
    expect(formatElapsed(5 * 60_000)).toBe("5m");
    expect(formatElapsed(3 * 3_600_000 + 5 * 60_000)).toBe("3h 5m");
    expect(formatElapsed(50 * 3_600_000)).toBe("2d 2h");
    expect(formatElapsed(-1000)).toBe("0m");
  });

  it("counts down to the reset time in hours and minutes", () => {
    const { formatCountdown } = time();
    const now = 1_700_000_000_000;
    const resetsAt = (now + (9 * 60 + 40) * 60_000) * 1000;
    expect(formatCountdown(resetsAt, now)).toBe("9h 40m");
  });
});
