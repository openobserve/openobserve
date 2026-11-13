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
import ServiceScopeChip from "./ServiceScopeChip.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import { raw } from "@/types/i18n";

describe("ServiceScopeChip", () => {
  it("names the facet by default and keeps the facet's colour group", () => {
    const chip = mount(ServiceScopeChip, { props: { facet: "where", value: "stage6 · web" } });
    expect(chip.findComponent(ODimensionChip).props("dimKey")).toBe("where");
    expect(chip.text()).toContain("stage6 · web");
  });

  it("swaps only the key segment for a host label, so a baseline chip reads in the where colour", () => {
    const chip = mount(ServiceScopeChip, {
      props: { facet: "where", value: "stage6 · web", label: raw("baseline from") },
    });
    expect(chip.findComponent(ODimensionChip).props("dimKey")).toBe("where");
    expect(chip.findComponent(ODimensionChip).props("keyLabel")).toBe("baseline from");
  });
});
