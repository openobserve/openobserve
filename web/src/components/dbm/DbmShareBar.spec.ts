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

import DbmShareBar from "./DbmShareBar.vue";

const mountBar = (props: Record<string, unknown> = {}) =>
  mount(DbmShareBar, {
    props: {
      share: 0.4,
      trackClass: "h-1.5 w-13 shrink-0",
      fillClass: "bg-status-warning-text",
      ...props,
    },
  });

describe("DbmShareBar", () => {
  /**
   * A TRACK with a fill inside it, not a bare fill. The absent part has to stay
   * visible: without the track, "3% of waits" and "3% of a short column" draw
   * the same stub and the comparison the bar exists for is gone.
   */
  it("draws the whole as a track and the share as a fill inside it", () => {
    const wrapper = mountBar();

    expect(wrapper.classes()).toEqual(
      expect.arrayContaining(["bg-surface-subtle", "overflow-hidden", "rounded-full"]),
    );

    const fill = wrapper.get("span > span");
    expect(fill.classes()).toEqual(
      expect.arrayContaining(["block", "h-full", "rounded-full", "bg-status-warning-text"]),
    );
    expect(fill.attributes("style")).toContain("width: 40%");
  });

  /** Each caller sizes the track to its own column — one is beside a number, one under it. */
  it("takes the caller's track size", () => {
    expect(mountBar({ trackClass: "mt-0.5 h-1 w-14" }).classes()).toEqual(
      expect.arrayContaining(["mt-0.5", "h-1", "w-14"]),
    );
  });

  /**
   * The tone is a class, not a variant name: deadlocks picks it off a boolean
   * severity and blocked queries off a threshold over the share itself, so
   * naming a shared set of variants would fit neither.
   */
  it("takes the tone the page's own severity rule resolved", () => {
    expect(mountBar({ fillClass: "bg-status-error-text" }).get("span > span").classes()).toContain(
      "bg-status-error-text",
    );
  });

  /** A zero share collapses the fill rather than hiding the track. */
  it("collapses the fill at zero and fills the track at one", () => {
    expect(mountBar({ share: 0 }).get("span > span").attributes("style")).toContain("width: 0%");
    expect(mountBar({ share: 1 }).get("span > span").attributes("style")).toContain("width: 100%");
  });
});
