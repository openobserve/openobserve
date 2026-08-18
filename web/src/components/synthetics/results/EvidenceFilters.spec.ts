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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import EvidenceFilters from "./EvidenceFilters.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { raw } from "@/types/i18n";

const VIEWS = [
  { key: "all" as const, label: raw("All"), count: 3 },
  { key: "network" as const, label: raw("Network"), count: 2 },
  { key: "console" as const, label: raw("Console"), count: 1 },
];

const mountFilters = (props: Record<string, unknown> = {}) =>
  mount(EvidenceFilters, {
    props: { views: VIEWS, view: "all", firstPartyOnly: false, wrap: false, ...props },
    global: { plugins: [i18n] },
  });

describe("EvidenceFilters", () => {
  it("offers one option per view, each with its count", () => {
    const w = mountFilters();
    for (const v of VIEWS) {
      expect(w.find(`[data-test="synthetics-evidence-filter-${v.key}"]`).text()).toContain(
        String(v.count),
      );
    }
  });

  it("asks its parent to change the view rather than changing it itself", async () => {
    const w = mountFilters();
    await w.find('[data-test="synthetics-evidence-filter-console"]').trigger("click");
    expect(w.emitted("update:view")?.[0]).toEqual(["console"]);
  });

  it("toggles wrap through the parent", async () => {
    const w = mountFilters();
    await w.find('[data-test="synthetics-evidence-wrap-btn"]').trigger("click");
    expect(w.emitted("update:wrap")?.[0]).toEqual([true]);
  });

  it("marks the wrap button active when wrapping, and only then", () => {
    // The only OButton here is the wrap toggle, so its `active` prop is the
    // narrowest stable signal — narrower than parsing the generated classes.
    expect(mountFilters({ wrap: true }).findComponent(OButton).props("active")).toBe(true);
    expect(mountFilters({ wrap: false }).findComponent(OButton).props("active")).toBe(false);
  });
});
