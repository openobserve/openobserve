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
      dotClass: "bg-status-success-text",
      dataTest: "dbm-deadlocks-coverage",
      ...props,
    },
  });

describe("DbmLockCoverageLine", () => {
  /**
   * The band is what makes the claim read as part of the table frame rather
   * than as a floating note: the table's own gutter, and a bottom border that
   * closes it against the rows below.
   */
  it("sits in the table frame, aligned to its gutter", () => {
    expect(mountLine().classes()).toEqual([
      "border-border-subtle",
      "bg-surface-base",
      "text-text-secondary",
      "text-2xs",
      "px-page-edge",
      "flex",
      "shrink-0",
      "items-center",
      "gap-2",
      "border-b",
      "py-1",
    ]);
    expect(mountLine().attributes("data-test")).toBe("dbm-deadlocks-coverage");
  });

  /**
   * The dot is the at-a-glance verdict. A capped read is warning-toned, a
   * complete one is not — and the two pages decide that on different facts, so
   * the tone arrives already resolved.
   */
  it("wears the tone the page resolved", () => {
    expect(mountLine().get("span").classes()).toEqual(
      expect.arrayContaining(["size-1.5", "shrink-0", "rounded-full", "bg-status-success-text"]),
    );
    expect(mountLine({ dotClass: "bg-status-warning-text" }).get("span").classes()).toContain(
      "bg-status-warning-text",
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
