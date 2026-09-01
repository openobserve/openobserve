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

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import OStatStrip from "./OStatStrip.vue";
import { raw } from "@/types/i18n";

const items = [
  { key: "a", label: raw("All"), value: 128 },
  { key: "b", label: raw("Regressed"), value: 93 },
];

function basisOf(compact: boolean) {
  const wrapper = mount(OStatStrip, {
    props: { items, compact },
    global: { stubs: { OStatCard: { template: '<div v-bind="$attrs" />' } } },
  });
  return wrapper.findAll("[class]")[1]?.classes() ?? [];
}

describe("OStatStrip", () => {
  // A five-tile filter strip wraps to two rows at the default basis, which is
  // sized for long labels.
  it("narrows the wrap threshold when compact", () => {
    expect(basisOf(false)).toContain("basis-52");
    expect(basisOf(true)).toContain("basis-36");
  });

  it("keeps the tiles growing to fill the strip either way", () => {
    expect(basisOf(false)).toContain("grow");
    expect(basisOf(true)).toContain("grow");
  });

  // ── which tile reads as active ────────────────────────────────────────────
  describe("selection", () => {
    const selectedKeys = (props: Record<string, unknown>) =>
      mount(OStatStrip, {
        props: { items, selectable: true, ...props },
        global: {
          stubs: {
            OStatCard: {
              props: ["selected", "dataTest"],
              template: '<div :data-test="dataTest" :data-selected="String(selected)" />',
            },
          },
        },
      }).findAll("[data-selected='true']").length;

    const selectedTile = (props: Record<string, unknown>) => {
      const wrapper = mount(OStatStrip, {
        props: { items, selectable: true, ...props },
        global: {
          stubs: {
            OStatCard: {
              props: ["selected"],
              template: '<div data-card :data-selected="String(selected)" />',
            },
          },
        },
      });
      return wrapper
        .findAll("[data-card]")
        .findIndex((card) => card.attributes("data-selected") === "true");
    };

    it("marks the selected tile", () => {
      expect(selectedTile({ selectedKey: "b" })).toBe(1);
    });

    it("falls back to the default tile when nothing is filtered", () => {
      // Otherwise the strip shows NO tile active while the grid behind it is
      // showing everything — a state the control cannot express.
      expect(selectedTile({ selectedKey: null, defaultKey: "a" })).toBe(0);
    });

    it("falls back when the filter names no tile of its own", () => {
      // Several callers spell "no filter" as the string "all" rather than null.
      expect(selectedTile({ selectedKey: "all", defaultKey: "a" })).toBe(0);
    });

    it("lights exactly one tile, never two", () => {
      expect(selectedKeys({ selectedKey: "b", defaultKey: "a" })).toBe(1);
      expect(selectedKeys({ selectedKey: null, defaultKey: "a" })).toBe(1);
    });

    it("leaves every tile unlit when there is no default to fall back to", () => {
      expect(selectedKeys({ selectedKey: null })).toBe(0);
    });

    it("announces which tile is pressed, not just a border colour", () => {
      // The only cue today is `border-accent`, so the filter state does not
      // exist for anyone using a screen reader.
      const wrapper = mount(OStatStrip, {
        props: { items, selectable: true, selectedKey: "b", defaultKey: "a" },
      });
      const pressed = wrapper.findAll("button").map((b) => b.attributes("aria-pressed"));
      expect(pressed).toEqual(["false", "true"]);
    });

    it("leaves a static strip's tiles unpressable, not merely unpressed", () => {
      const wrapper = mount(OStatStrip, { props: { items } });
      expect(wrapper.findAll("button")).toHaveLength(0);
      expect(wrapper.find("[aria-pressed]").exists()).toBe(false);
    });

    it("stays inert when the strip is not selectable", () => {
      expect(selectedKeys({ selectable: false, selectedKey: "b", defaultKey: "a" })).toBe(0);
    });
  });
});
