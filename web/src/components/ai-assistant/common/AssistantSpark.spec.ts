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
import { defineComponent, h } from "vue";

import AssistantSpark from "./AssistantSpark.vue";
import { ASSISTANT_MOTION } from "./assistantMotion";

describe("AssistantSpark", () => {
  it("is a decorative gradient star with no image", () => {
    const spark = mount(AssistantSpark).get('[data-test="assistant-spark"]');
    expect(spark.attributes("aria-hidden")).toBe("true");
    expect(spark.find("img").exists()).toBe(false);
    const stops = spark.findAll("stop").map((stop) => stop.attributes("style"));
    expect(stops.join(" ")).toContain("--color-assistant-spark-from");
    expect(stops.join(" ")).toContain("--color-assistant-spark-to");
  });

  it.each([
    [16, "size-4"],
    [20, "size-5"],
    [24, "size-6"],
    [32, "size-8"],
  ] as const)("size %s renders %s", (size, cls) => {
    expect(mount(AssistantSpark, { props: { size } }).classes()).toContain(cls);
  });

  it("gives each spark on a page its own gradient", () => {
    const pair = mount(defineComponent(() => () => [h(AssistantSpark), h(AssistantSpark)]));
    const ids = pair.findAll("linearGradient").map((g) => g.attributes("id"));
    expect(new Set(ids).size).toBe(2);
    for (const [i, path] of pair.findAll("path").entries())
      expect(path.attributes("fill")).toBe(`url(#${ids[i]})`);
  });

  it("paints the system text colour in forced colours", () => {
    expect(mount(AssistantSpark).get("path").classes()).toContain("forced-colors:fill-current");
  });

  it("turns its colours while working, unless muted", () => {
    const working = mount(AssistantSpark, { props: { working: true } });
    expect(working.get('[data-test="assistant-spark-working"]').classes()).toContain(
      ASSISTANT_MOTION.sparkWorking,
    );
    expect(working.find("svg").exists()).toBe(false);
    const muted = mount(AssistantSpark, { props: { working: true, muted: true } });
    expect(muted.find('[data-test="assistant-spark-working"]').exists()).toBe(false);
    expect(muted.get("path").attributes("fill")).toBe("currentColor");
  });
});
