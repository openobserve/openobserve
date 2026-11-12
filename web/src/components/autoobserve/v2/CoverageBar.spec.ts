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
import i18n from "@/locales";
import CoverageBar from "./CoverageBar.vue";

const mountBar = (props: Record<string, unknown>) =>
  mount(CoverageBar, { props, global: { plugins: [i18n] } });

const legend = (wrapper: ReturnType<typeof mountBar>) =>
  wrapper
    .findAll('[data-test^="autoobserve2-headline-legend-"]')
    .map((b) => [b.attributes("data-test"), b.text()]);

describe("CoverageBar legend", () => {
  it("uses the two live words, Watched and Coverage gap, with the gap key", () => {
    expect(legend(mountBar({ watching: 3, learning: 0, gaps: 1, live: true }))).toEqual([
      ["autoobserve2-headline-legend-watched", "Watched 3"],
      ["autoobserve2-headline-legend-gap", "Coverage gap 1"],
    ]);
  });

  it("keeps the fixture words and the unseen key outside live mode", () => {
    const wrapper = mountBar({ watching: 3, learning: 2, gaps: 1 });
    const keys = legend(wrapper).map(([key]) => key);
    expect(keys).toEqual([
      "autoobserve2-headline-legend-watching",
      "autoobserve2-headline-legend-learning",
      "autoobserve2-headline-legend-unseen",
    ]);
  });

  it("drops a segment with no services", () => {
    const keys = legend(mountBar({ watching: 4, learning: 0, gaps: 0, live: true })).map(
      ([key]) => key,
    );
    expect(keys).toEqual(["autoobserve2-headline-legend-watched"]);
  });

  it("gives the live bar segments the same watched and gap keys", () => {
    const keys = mountBar({ watching: 3, learning: 0, gaps: 1, live: true })
      .findAll('[data-test^="autoobserve2-headline-bar-"]')
      .map((b) => b.attributes("data-test"));
    expect(keys).toEqual(["autoobserve2-headline-bar-watched", "autoobserve2-headline-bar-gap"]);
  });
});
