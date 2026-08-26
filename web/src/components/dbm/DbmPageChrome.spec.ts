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
import { describe, expect, it, vi } from "vitest";

import type { DbmTabCountProps } from "@/composables/dbm/useDbmTabCounts";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

import DbmPageChrome from "./DbmPageChrome.vue";
import DbmSectionTabs from "./DbmSectionTabs.vue";

// The tab strip reads the route to decide which tab is current.
vi.mock("vue-router", () => ({
  useRoute: () => ({ name: "dbmDeadlocks", query: {} }),
  useRouter: () => ({ push: vi.fn(() => Promise.resolve()) }),
}));

const tabCounts: DbmTabCountProps = { queryCount: 12, databaseCount: 3 };

const mountChrome = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
  mount(DbmPageChrome, {
    props: {
      title: raw("Deadlocks"),
      subtitle: raw("Query pairs that deadlocked"),
      titleDataTest: "dbm-deadlocks-title",
      tabCounts,
      ...props,
    },
    slots,
    global: {
      plugins: [i18n],
      stubs: { RouterLink: true },
    },
  });

describe("DbmPageChrome", () => {
  /**
   * What made seven headers one header: the database icon, the tab row BELOW
   * the title, and a bleeding body. Drop `tabs-below` and the strip climbs into
   * the title row; drop `bleed` and every table gains a gutter its rows do not.
   */
  it("is the tabs-below, bleeding, database-iconed page layout", () => {
    const layout = mountChrome().findComponent(OPageLayout);

    expect(layout.props("icon")).toBe("database");
    expect(layout.props("tabsBelow")).toBe(true);
    expect(layout.props("bleed")).toBe(true);
  });

  it("carries the page's title, subtitle and title data-test", () => {
    const layout = mountChrome().findComponent(OPageLayout);

    expect(layout.props("title")).toBe("Deadlocks");
    expect(layout.props("subtitle")).toBe("Query pairs that deadlocked");
    expect(layout.props("titleDataTest")).toBe("dbm-deadlocks-title");
  });

  /**
   * The counts arrive from the shell's one fan-out with the page's own number
   * substituted in; this header is what puts them on the strip. Hand them to
   * anything else and every tab paints an empty badge.
   */
  it("hands the page's counts to the shared tab strip", () => {
    expect(mountChrome().findComponent(DbmSectionTabs).props()).toMatchObject({
      queryCount: 12,
      databaseCount: 3,
    });
  });

  it("renders the page's body", () => {
    expect(
      mountChrome({}, { default: '<div data-test="body" />' }).find('[data-test="body"]').exists(),
    ).toBe(true);
  });
});
