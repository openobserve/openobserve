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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

import OTabs from "./OTabs.vue";
import OTab from "./OTab.vue";
import { resolveColor, resolveTokens, type Rgba } from "@/lib/styles/tokens/colorMath";

const here = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(here, "../../styles/tokens");
const THEMES = resolveTokens(
  ["base.css", "semantic.css", "component.css", "dark.css"].map((file) =>
    readFileSync(join(TOKENS, file), "utf8"),
  ),
);

/** Pinned (light, dark) with the stock theme so a token refactor cannot change what a horizontal tab strip renders. */
const MAIN: Record<string, [string, string]> = {
  "--color-focus-ring-accent": ["#3f7994", "#79a1b4"],
  "--color-tabs-active-text": ["#326176", "#ffffff"],
  "--color-tabs-disabled-text": ["#a3a3a3", "#525252"],
  "--color-tabs-hover-text": ["#262626", "#e5e5e5"],
  "--color-tabs-inactive-text": ["#262626", "#e5e5e5"],
  "--color-tabs-indicator": ["#3f7994", "#3f7994"],
};

const UTILITY = /^(?:[a-z-]+:)*(?:text|bg|border(?:-[se])?|outline)-([a-z][a-z0-9-]+)$/;

function hex(color: Rgba): string {
  const channels = [color.r, color.g, color.b].map((v) =>
    Math.round(v).toString(16).padStart(2, "0"),
  );
  return `#${channels.join("")}`;
}

function mountStrip(disableActive = false) {
  return mount({
    components: { OTabs, OTab },
    data: () => ({ disableActive }),
    template: `<OTabs model-value="a">
      <OTab name="a" label="O2 Assistant" :disable="disableActive" />
      <OTab name="b" label="Overview" />
      <OTab name="c" label="Usage" disable />
      <OTab name="d"><span>Slot tab</span></OTab>
    </OTabs>`,
  });
}

function colourTokens(classes: string[]): string[] {
  const names = new Set<string>();
  for (const name of classes) {
    const match = UTILITY.exec(name);
    if (!match) continue;
    const token = `--color-${match[1]}`;
    if (resolveColor(token, THEMES.light) && resolveColor(token, THEMES.dark)) names.add(token);
  }
  return [...names].sort();
}

describe("horizontal tabs keep main's colours", () => {
  it("colours the active tab in brand ink and the others in main's inactive ink and hover", () => {
    const [active, inactive, disabled, slot] = mountStrip().findAll('[role="tab"]');
    expect(active.classes()).toContain("text-tabs-active-text");
    expect(active.classes()).not.toContain("text-text-heading");
    for (const tab of [inactive, slot]) {
      expect(tab.classes()).toEqual(
        expect.arrayContaining(["text-tabs-inactive-text", "enabled:hover:text-tabs-hover-text"]),
      );
    }
    expect(disabled.classes()).toContain("text-tabs-disabled-text");
  });

  it("keeps a locked active tab in brand ink", () => {
    const [active] = mountStrip(true).findAll('[role="tab"]');
    expect(active.classes()).toContain("text-tabs-active-text");
  });

  it("draws the sliding underline in main's indicator colour", () => {
    expect(mountStrip().find(".bg-tabs-indicator").exists()).toBe(true);
  });

  it.each([
    ["light", 0],
    ["dark", 1],
  ] as const)("resolves every strip colour to main's value in %s", (theme, index) => {
    const classes = [mountStrip(), mountStrip(true)].flatMap((wrapper) =>
      wrapper.findAll("*").flatMap((el) => el.classes()),
    );
    const tokens = colourTokens(classes);
    expect(tokens).toEqual(Object.keys(MAIN).sort());
    for (const name of tokens) {
      expect(hex(resolveColor(name, THEMES[theme])!), name).toBe(MAIN[name][index]);
    }
  });
});
