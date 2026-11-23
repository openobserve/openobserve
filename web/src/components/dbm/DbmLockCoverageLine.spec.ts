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

import { raw } from "@/types/i18n";

import DbmLockCoverageLine from "./DbmLockCoverageLine.vue";

const mountLine = (props: Record<string, unknown> = {}) =>
  mount(DbmLockCoverageLine, {
    props: {
      summary: raw("All 43 deadlocks in the window"),
      variant: "info",
      dataTest: "dbm-deadlocks-coverage",
      ...props,
    },
  });

describe("DbmLockCoverageLine", () => {
  it("carries its data-test and the variant the page resolved", () => {
    expect(mountLine().attributes("data-test")).toBe("dbm-deadlocks-coverage");
    expect(mountLine().findComponent({ name: "OBanner" }).props("variant")).toBe("info");
    expect(
      mountLine({ variant: "warning" }).findComponent({ name: "OBanner" }).props("variant"),
    ).toBe("warning");
  });

  it("renders nothing for a complete all-good read", () => {
    expect(mountLine({ variant: null }).find("[data-test='dbm-deadlocks-coverage']").exists()).toBe(
      false,
    );
  });

  it("states the coverage claim", () => {
    expect(mountLine().text()).toContain("All 43 deadlocks in the window");
  });

  /**
   * The separator belongs to the trailing label. A page that does not know when
   * the read was taken must not render a dangling middot, which reads as a fact
   * that failed to load.
   */
  it("separates a trailing label, and renders no separator without one", () => {
    const withLabel = mountLine({ trailingLabel: raw("read up to 14:02") });
    expect(withLabel.text()).toContain("·");
    expect(withLabel.text()).toContain("read up to 14:02");

    expect(mountLine().text()).not.toContain("·");
  });
});
