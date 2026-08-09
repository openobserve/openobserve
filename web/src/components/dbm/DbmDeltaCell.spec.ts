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

import i18n from "@/locales";
import type { DbmDelta } from "@/utils/dbm/insights";

import DbmDeltaCell from "./DbmDeltaCell.vue";

const mountWith = (delta: DbmDelta, props: Record<string, unknown> = {}) =>
  mount(DbmDeltaCell, { props: { delta, ...props }, global: { plugins: [i18n] } });

describe("DbmDeltaCell", () => {
  describe("the three states", () => {
    it("renders a signed percentage for a real comparison", () => {
      const wrapper = mountWith({ state: "changed", current: 150, previous: 100, ratio: 0.5 });
      expect(wrapper.text()).toContain("+50%");
    });

    it("renders `new` as a chip and NEVER as -100%", () => {
      // The bug this component exists to prevent: an arrival reading as a collapse.
      const wrapper = mountWith({ state: "new", current: 500 });
      expect(wrapper.text()).toContain("new");
      expect(wrapper.text()).not.toContain("%");
      expect(wrapper.text()).not.toContain("-100");
    });

    it("renders `gone` as a chip rather than dropping the row silently", () => {
      const wrapper = mountWith({ state: "gone", previous: 900 });
      // "stopped running" rather than the internal word "gone": the plain-language
      // rule bans our vocabulary from visible copy.
      expect(wrapper.text()).toContain("stopped running");
      expect(wrapper.text()).not.toContain("%");
    });

    it("renders an em dash when a comparison exists but no ratio can be computed", () => {
      // previous === 0: any rise is infinite, so no percentage is honest.
      const wrapper = mountWith({ state: "changed", current: 500, previous: 0 });
      expect(wrapper.text()).toContain("—");
      expect(wrapper.text()).not.toContain("%");
    });
  });

  describe("direction and tone", () => {
    it("tints a rise in a cost metric as bad", () => {
      const wrapper = mountWith({ state: "changed", current: 200, previous: 100, ratio: 1 });
      expect(wrapper.html()).toContain("text-status-error-text");
    });

    it("leaves an improvement quiet — good news does not shout", () => {
      const wrapper = mountWith({ state: "changed", current: 50, previous: 100, ratio: -0.5 });
      expect(wrapper.html()).not.toContain("text-status-error-text");
    });

    it("never tints when the metric has no good direction", () => {
      const wrapper = mountWith(
        { state: "changed", current: 200, previous: 100, ratio: 1 },
        { semantics: "neutral" },
      );
      expect(wrapper.html()).not.toContain("text-status-error-text");
    });

    it("keeps a sub-5% wobble grey and arrow-less", () => {
      const wrapper = mountWith({ state: "changed", current: 102, previous: 100, ratio: 0.02 });
      expect(wrapper.html()).toContain("text-text-muted");
      expect(wrapper.find("svg").exists()).toBe(false);
    });
  });

  /**
   * The worded variants exist because a signed percentage makes the reader do
   * arithmetic to decide whether it matters. Under a call count "5× more" lands
   * immediately; under a duration the previous SPEED is what they want.
   */
  describe("worded variants", () => {
    it("says a large rise as a multiple rather than a percentage", () => {
      const wrapper = mountWith(
        { state: "changed", current: 500, previous: 100, ratio: 4 },
        { variant: "words" },
      );
      expect(wrapper.text()).toContain("5× more");
      expect(wrapper.text()).not.toContain("400%");
    });

    it("says a large fall as a multiple the other way", () => {
      const wrapper = mountWith(
        { state: "changed", current: 100, previous: 500, ratio: -0.8 },
        { variant: "words" },
      );
      expect(wrapper.text()).toContain("5× fewer");
    });

    it("states 'no change' explicitly rather than rendering blank", () => {
      // A blank cell reads as missing data, and "steady" vs "unknown" is the
      // whole question on this table.
      const wrapper = mountWith(
        { state: "changed", current: 101, previous: 100, ratio: 0.01 },
        { variant: "words" },
      );
      expect(wrapper.text()).toContain("no change");
    });

    it("reports the previous value under a duration", () => {
      const wrapper = mountWith(
        { state: "changed", current: 304, previous: 98, ratio: 2.1 },
        { variant: "was", previousLabel: "98ms" },
      );
      expect(wrapper.text()).toContain("was 98ms");
    });

    /**
     * `new`/`gone` are facts about the ROW, which already carries them as a
     * chip. Repeating them under every number would state the same thing three
     * times and read as if the call COUNT were new.
     */
    it("stays silent on a new row instead of repeating the row's own chip", () => {
      const wrapper = mountWith({ state: "new", current: 500 }, { variant: "words" });
      expect(wrapper.text().trim()).toBe("");
    });
  });

  describe("hover explanation", () => {
    it("explains what `new` means rather than leaving the chip bare", () => {
      const wrapper = mountWith({ state: "new", current: 500 });
      // The caveat is the point: "new to this list" is first RANK ENTRY, not a
      // newly written query, and the hover has to say so or the chip misleads.
      expect(wrapper.attributes("title")).toContain("wasn't among the heaviest earlier");
    });

    it("shows both windows' values when they are supplied", () => {
      const wrapper = mountWith(
        { state: "changed", current: 200, previous: 100, ratio: 1 },
        { currentLabel: "200ms", previousLabel: "100ms" },
      );
      expect(wrapper.attributes("title")).toContain("100ms");
      expect(wrapper.attributes("title")).toContain("200ms");
    });
  });
});
