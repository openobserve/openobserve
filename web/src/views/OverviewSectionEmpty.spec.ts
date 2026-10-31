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
import { raw } from "@/types/i18n";
import OverviewSectionEmpty from "./OverviewSectionEmpty.vue";

const mountEmpty = (props: Record<string, unknown>) =>
  mount(OverviewSectionEmpty, {
    props: { section: "incidents", title: raw("Active incidents"), kind: "empty", ...props },
    global: { plugins: [i18n] },
  });

describe("OverviewSectionEmpty", () => {
  it("renders the empty message inside the shared inline empty state", () => {
    const w = mountEmpty({});
    const message = w.get('[data-test="overview-incidents-empty-message"]');
    expect(message.text()).toContain("No open incidents");
    expect(w.find("[data-o2-empty-state], .o2-empty-state").exists()).toBe(true);
  });

  it("renders the no access message for a forbidden section", () => {
    const w = mountEmpty({ kind: "forbidden" });
    expect(w.get('[data-test="overview-incidents-forbidden-message"]').text()).toContain(
      "No access",
    );
  });

  it("uses the hyphenated test id for recent events", () => {
    const w = mountEmpty({ section: "recentEvents" });
    expect(w.find('[data-test="overview-recent-events-empty-message"]').exists()).toBe(true);
  });
});
