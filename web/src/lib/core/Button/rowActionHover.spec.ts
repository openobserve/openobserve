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
import OButton from "./OButton.vue";
import type { ButtonVariant } from "./OButton.types";

const STEP = "group-hover/row:enabled:hover:not-active:bg-table-row-action-hover-bg";
const NEUTRAL_HOVER =
  /(^|\s)enabled:hover:bg-button-(ghost|ghost-primary|ghost-muted|ghost-subtle)-hover-bg(\s|$)|(^|\s)enabled:hover:bg-button-secondary-hover(\s|$)/;

function classesOf(variant: ButtonVariant): string {
  return mount(OButton, { props: { variant }, slots: { default: "Go" } })
    .find("button")
    .classes()
    .join(" ");
}

describe("a ghost hover inside a hovered table row (item 1)", () => {
  it.each([
    "ghost",
    "ghost-primary",
    "ghost-muted",
    "ghost-subtle",
    "secondary",
    "ghost-neutral",
    "row",
  ] as const)("steps the %s hover up to the row-action fill", (variant) => {
    const classes = classesOf(variant);
    expect(classes).toMatch(NEUTRAL_HOVER);
    expect(classes.split(" ")).toContain(STEP);
  });

  it.each(["primary", "ghost-destructive", "outline"] as const)(
    "leaves the %s hover, which never matched the row fill, alone",
    (variant) => {
      expect(classesOf(variant).split(" ")).not.toContain(STEP);
    },
  );
});
