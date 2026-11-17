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

/** Pinned (light, dark) with the stock theme so a token refactor cannot change what a vertical tab renders. */
const MAIN: Record<string, [string, string]> = {
  "--color-focus-ring-accent": ["#3f7994", "#79a1b4"],
  "--color-tabs-active-bg": ["#e2ebef", "#19303b"],
  "--color-tabs-active-text": ["#326176", "#ffffff"],
  "--color-tabs-disabled-text": ["#a3a3a3", "#525252"],
  "--color-tabs-hover-text": ["#262626", "#e5e5e5"],
  "--color-tabs-rail-hover-bg": ["#ededed", "#262626"],
  "--color-text-body": ["#404040", "#d4d4d4"],
};

const UTILITY = /^(?:[a-z-]+:)*(?:text|bg|border(?:-[se])?|outline)-([a-z][a-z0-9-]+)$/;

function hex(color: Rgba): string {
  const channels = [color.r, color.g, color.b].map((v) =>
    Math.round(v).toString(16).padStart(2, "0"),
  );
  return `#${channels.join("")}`;
}

function mountRail(modelValue: string, disableActive = false) {
  return mount({
    components: { OTabs, OTab },
    data: () => ({ modelValue, disableActive }),
    template: `<OTabs orientation="vertical" :model-value="modelValue">
      <OTab name="a" label="Alerts" icon="notifications" :disable="disableActive" />
      <OTab name="b" label="Organization parameters" />
      <OTab name="c" label="Locked" disable />
    </OTabs>`,
  });
}

function mountFolderRail() {
  return mount({
    components: { OTabs, OTab },
    template: `<OTabs orientation="vertical" dense model-value="default">
      <OTab name="default"><span>default</span></OTab>
      <OTab name="ops"><span>ops</span></OTab>
    </OTabs>`,
  });
}

function tabs(wrapper: ReturnType<typeof mount>) {
  const [active, inactive, disabled] = wrapper.findAll('[role="tab"]');
  return { active, inactive, disabled };
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

describe("vertical tabs render as on main", () => {
  it("colours the active tab in brand ink at the medium weight with a full accent ring", () => {
    const { active } = tabs(mountRail("a"));
    expect(active.classes()).toEqual(
      expect.arrayContaining([
        "text-tabs-active-text",
        "font-medium",
        "bg-tabs-active-bg",
        "ring-tabs-indicator",
        "ring-inset",
      ]),
    );
    expect(active.classes()).not.toContain("font-semibold");
    expect(active.classes()).not.toContain("text-text-heading");
  });

  it("keeps main's inactive ink and hover", () => {
    const { inactive } = tabs(mountRail("a"));
    expect(inactive.classes()).toEqual(
      expect.arrayContaining([
        "text-text-body",
        "enabled:hover:text-tabs-hover-text",
        "enabled:hover:bg-tabs-rail-hover-bg",
        "font-normal",
      ]),
    );
  });

  it("keeps a locked active tab in brand ink", () => {
    const { active } = tabs(mountRail("a", true));
    expect(active.classes()).toContain("text-tabs-active-text");
    expect(active.classes()).not.toContain("text-text-heading");
  });

  it("colours slot-content rows like the alerts folder list as on main", () => {
    const [active, inactive] = mountFolderRail().findAll('[role="tab"]');
    expect(active.classes()).toEqual(
      expect.arrayContaining(["text-tabs-active-text", "bg-tabs-active-bg", "font-medium"]),
    );
    expect(inactive.classes()).toEqual(
      expect.arrayContaining(["text-text-body", "enabled:hover:text-tabs-hover-text"]),
    );
  });

  it("starts each label at the tab's start edge without reserving a bold width", () => {
    for (const tab of mountRail("a").findAll('[role="tab"]')) {
      const label = tab.find("[data-otab-label]");
      expect(label.classes()).toContain("text-start");
      expect(label.classes().filter((name) => name.startsWith("after:"))).toEqual([]);
    }
  });

  it.each([
    ["light", 0],
    ["dark", 1],
  ] as const)("resolves every tab colour to main's value in %s", (theme, index) => {
    const classes = [
      ...Object.values(tabs(mountRail("a"))),
      tabs(mountRail("a", true)).active,
      ...mountFolderRail().findAll('[role="tab"]'),
    ].flatMap((tab) => tab.classes());
    const tokens = colourTokens(classes);
    expect(tokens).toEqual(Object.keys(MAIN).sort());
    for (const name of tokens) {
      expect(hex(resolveColor(name, THEMES[theme])!), name).toBe(MAIN[name][index]);
    }
  });
});
