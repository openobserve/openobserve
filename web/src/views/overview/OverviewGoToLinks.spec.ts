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
import { computed } from "vue";

import { GO_TO_PAGES, type GoToPage } from "@/composables/goto/types";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

import OverviewGoToLinks from "./OverviewGoToLinks.vue";

const page = (id: string, label: string): GoToPage => ({
  id,
  label: raw(label),
  route: { name: id },
});

const mountLinks = (pages: GoToPage[] | null) =>
  mount(OverviewGoToLinks, {
    global: {
      plugins: [i18n],
      provide: pages ? { [GO_TO_PAGES as symbol]: computed(() => pages) } : {},
    },
  });

describe("OverviewGoToLinks", () => {
  it("lists the six board destinations in board order, only those the menu shows", () => {
    const wrapper = mountLinks([
      page("incidentList", "Incidents"),
      page("home", "Home"),
      page("logs", "Logs"),
      page("traces:service-graph", "Service graph"),
      page("alertList", "Alerts"),
    ]);
    expect(
      wrapper.findAll('[data-test^="overview-go-to-"]').map((b) => b.attributes("data-test")),
    ).toEqual([
      "overview-go-to-links",
      "overview-go-to-logs",
      "overview-go-to-alertList",
      "overview-go-to-incidentList",
    ]);
    expect(wrapper.text()).toContain("Go to from any page");
  });

  it("emits the page to open", async () => {
    const logs = page("logs", "Logs");
    const wrapper = mountLinks([logs]);
    await wrapper.get('[data-test="overview-go-to-logs"]').trigger("click");
    expect(wrapper.emitted("open")).toEqual([[logs]]);
  });

  it("renders nothing without the menu's pages", () => {
    expect(mountLinks(null).find('[data-test="overview-go-to-links"]').exists()).toBe(false);
  });
});
