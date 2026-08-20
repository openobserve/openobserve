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
  OButton: { name: "OButton", template: "<button><slot /></button>" },
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
  ODimensionChip: {
    name: "ODimensionChip",
    props: ["dimKey", "keyLabel", "value"],
    template: `<span>{{ keyLabel ?? dimKey }}={{ value }}</span>`,
  },
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

  /// The winning rule was spelled as a path and the team as a ksuid — neither
  /// is read as prose. The rule now draws as the same key|value chips the
  /// routing tab uses, so a dimension looks the same wherever it is read.
  it("draws the winning ownership rule as dimension chips", () => {
    const wrapper = render({
      routingReason: "routed to tm_9 by ownership rule k8s-cluster=introspection/service=search",
    });

    expect(wrapper.find('[data-test="oncall-about-routing-reason"]').text()).toBe(
      "Matched an ownership rule",
    );
    const chips = wrapper.find('[data-test="oncall-about-routing-dimensions"]').text();
    expect(chips).toContain("k8s-cluster=introspection");
    expect(chips).toContain("service=search");
    // The ksuid belongs to the Team row below, which links; repeating it here
    // was the noisiest thing on the card.
    expect(wrapper.find('[data-test="oncall-about-routing-reason"]').text()).not.toContain("tm_9");
  });

  /// What routing passed over on the way is the half that answers "why not the
  /// team I expected", and the card used to drop it entirely.
  it("keeps the notes routing recorded before its decision", () => {
    const wrapper = render({
      routingReason:
        "the alert names team `paymnets`, which names no team in this org; " +
        "routed to tm_9 by ownership rule service=search",
    });
    expect(wrapper.find('[data-test="oncall-about-routing-note-0"]').text()).toContain("paymnets");
  });

  /// A mechanism with no rule behind it says so in words and draws no chips.
  it("says when the default team took it, without inventing a rule", () => {
    const wrapper = render({
      routingReason: "no ownership rule matched, so it went to the default team tm_9",
    });
    expect(wrapper.find('[data-test="oncall-about-routing-reason"]').text()).toContain(
      "default team",
    );
    expect(wrapper.find('[data-test="oncall-about-routing-dimensions"]').exists()).toBe(false);
  });

  // No decision recorded leaves the row out rather than rendering an empty one.
  it("omits the routing row when no decision was recorded", () => {
    expect(render().find('[data-test="oncall-about-routing-reason"]').exists()).toBe(false);
  });

  /// An alert that names its own team was never routed: no rule was consulted
  /// and none could have changed the outcome. The row would be a label, a
  /// sentence saying nothing happened, and a link to rules that had no say.
  it("omits the routing row when the alert named the team itself", () => {
    const wrapper = render({ routingReason: "routed to tm_9 by the alert's own setting" });
    expect(wrapper.find('[data-test="oncall-about-routing-reason"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-about-open-routing"]').exists()).toBe(false);
  });

  /// The id here IS the rule that woke somebody, and the trip to change it was
  /// a copy-paste into the alert list's search box. The editor lives on the
  /// list route behind `action=update` — `AlertDetail` navigates the same way.
  it("opens the alert's editor from its id", () => {
    const link = render()
      .findAllComponents({ name: "RouterLink" })
      .find((c) => c.attributes("data-test") === "oncall-about-subject-link");

    expect(link?.props("to")).toEqual({
      name: "alertList",
      query: {
        org_identifier: "default",
        action: "update",
        alert_id: "al_ckt",
        folder: "default",
      },
    });
  });

  /// A subject that is not an alert has no editor to open, and a chip that
  /// looks like a link and goes nowhere is worse than no link.
  it("leaves a non-alert subject unlinked", () => {
    const wrapper = render({ subjectType: "incident" as SubjectType, sourceId: "sig_1" });
    expect(wrapper.find('[data-test="oncall-about-subject-link"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-about-subject-id"]').exists()).toBe(true);
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

    const chip = render({ incidentId: "inc_9" }).find('[data-test="oncall-about-incident-link"]');
    expect(chip.text()).toContain("inc_9");
    // The chip labels itself, so the row above it no longer has to.
    expect(chip.text()).toContain("Incident");
  });

  /// The id is here to be pasted into a channel, so it keeps its copy control
  /// even though the chip truncates it on a narrow rail.
  it("names and copies the subject id", () => {
    const wrapper = render();
    expect(wrapper.find('[data-test="oncall-about-subject-id"]').text()).toContain("al_ckt");
    expect(wrapper.find('[data-test="oncall-about-subject-id"]').text()).toContain("Alert ID");
    expect(wrapper.find('[data-test="oncall-about-copy-subject"]').exists()).toBe(true);
  });
});
