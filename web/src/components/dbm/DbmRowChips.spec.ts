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

import DbmRowChips, { type DbmRowChip } from "./DbmRowChips.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

const mountChips = (chips: DbmRowChip[]) =>
  mount(DbmRowChips, { props: { chips }, global: { plugins: [i18n] } });

describe("DbmRowChips", () => {
  it("renders each fact as a soft OTag in its tone", () => {
    const wrapper = mountChips([
      { id: "failing", label: raw("All 380 failed"), tone: "error" },
      { id: "new", label: raw("New"), tone: "new" },
    ]);
    const tags = wrapper.findAllComponents(OTag);
    expect(tags.map((tag) => tag.props("variant"))).toEqual(["error-soft", "primary-soft"]);
    expect(wrapper.find('[data-test="dbm-row-chip-failing"]').text()).toContain("All 380 failed");
  });

  it("renders nothing without chips", () => {
    expect(mountChips([]).findAllComponents(OTag)).toHaveLength(0);
  });
});
