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

import OnCallAboutPage from "@/components/oncall/OnCallAboutPage.vue";
import i18n from "@/locales";
import type { SubjectType } from "@/ts/interfaces/oncall";

const stubs = {
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OCode: { name: "OCode", template: "<code><slot /></code>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTimeCell: { name: "OTimeCell", props: ["value"], template: "<span />" },
  OUserCell: { name: "OUserCell", props: ["value"], template: `<span>{{ value }}</span>` },
  ODescriptionList: { name: "ODescriptionList", template: "<dl><slot /></dl>" },
  ODescriptionItem: {
    name: "ODescriptionItem",
    props: ["label"],
    template: "<div><dt>{{ label }}</dt><dd><slot /></dd></div>",
  },
  RouterLink: { name: "RouterLink", props: ["to"], template: "<a><slot /></a>" },
};

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallAboutPage, {
    props: {
      orgId: "default",
      teamId: "team_1",
      teamName: "Gateway",
      subjectType: "alert" as SubjectType,
      sourceId: "al_ckt",
      openedAt: 1_700_000_000_000_000,
      ...props,
    },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallAboutPage", () => {
  /// "Why did this page me" was answerable only by scrolling the timeline,
  /// which is not where somebody asks it.
  it("states why this team was picked, and links to the rules", () => {
    const wrapper = render({ routingReason: "matched ownership rule namespace = envoy" });
    expect(wrapper.find('[data-test="oncall-about-routing-reason"]').text()).toBe(
      "matched ownership rule namespace = envoy",
    );
    expect(wrapper.find('[data-test="oncall-about-open-routing"]').exists()).toBe(true);
  });

  // No decision recorded leaves the row out rather than rendering an empty one.
  it("omits the routing row when no decision was recorded", () => {
    expect(render().find('[data-test="oncall-about-routing-reason"]').exists()).toBe(false);
  });

  /// The first thing worth knowing before starting to look, and it used to be
  /// a tab away.
  it("summarises what earlier firings turned out to be", () => {
    const wrapper = render({
      priorFirings: 6,
      priorCauses: [
        { cause: "noisy_threshold", count: 2, last_response_id: "r1" },
        { cause: "config_change_or_deploy", count: 4, last_response_id: "r2" },
      ],
    });
    // The dominant cause, not the first one the server happened to list.
    expect(wrapper.find('[data-test="oncall-about-history"]').text()).toContain("4×");
    expect(wrapper.find('[data-test="oncall-about-history"]').text()).toContain("Config change");
  });

  it("says outright when this is the first page from the subject", () => {
    expect(render().find('[data-test="oncall-about-history"]').text()).toContain(
      "first page from this subject",
    );
  });

  /// A firing with history but no recorded cause is not the same as no
  /// history — the count still has to be said.
  it("counts prior firings even when nobody recorded a cause", () => {
    const wrapper = render({ priorFirings: 3 });
    expect(wrapper.find('[data-test="oncall-about-history"]').text()).toContain(
      "3 earlier firings",
    );
  });

  it("links an incident once the page has been promoted into one", () => {
    expect(render().find('[data-test="oncall-about-incident-link"]').exists()).toBe(false);
    expect(
      render({ incidentId: "inc_9" }).find('[data-test="oncall-about-incident-link"]').text(),
    ).toBe("inc_9");
  });

  /// The id somebody pastes into a channel, copyable rather than a ksuid that
  /// truncates.
  it("keeps the subject id copyable", () => {
    expect(render().find('[data-test="oncall-about-subject-id"]').text()).toBe("al_ckt");
  });
});
