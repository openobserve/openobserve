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

import OnCallRoutingSimulator from "@/components/oncall/OnCallRoutingSimulator.vue";
import i18n from "@/locales";
import type { RoutingPreview } from "@/ts/interfaces/oncall";
import store from "@/test/unit/helpers/store";

const stubs = {
  OTag: { name: "OTag", props: ["variant"], template: "<span><slot /></span>" },
  OIcon: { name: "OIcon", template: "<i />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OUserCell: { name: "OUserCell", props: ["value"], template: "<span>{{ value }}</span>" },
  OButton: {
    name: "OButton",
    props: ["disabled"],
    template: `<button :disabled="disabled"><slot /></button>`,
  },
  OInput: {
    name: "OInput",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: `<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options"],
    emits: ["update:modelValue"],
    template: `<select :value="modelValue" />`,
  },
};

function preview(over: Partial<RoutingPreview> = {}): RoutingPreview {
  return {
    decision: { kind: "ownership", path: "service=payments-api" },
    team_id: "team_1",
    reason: "routed by ownership rule",
    ladder: [
      { priority: "P1", rungs: 3, pages_anyone: true, nobody_after_micros: 1_200_000_000, ends_with_whole_team: true },
    ],
    current_responder: {
      user_email: "aarav@o2.ai",
      reason: "on call",
      would_a_page_land: true,
      deliverable_channels: ["email"],
    },
    also_matched: [],
    notes: [],
    ...over,
  };
}

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallRoutingSimulator, {
    props: {
      teamId: "team_1",
      teamName: "Payments",
      teams: [
        { id: "team_1", name: "Payments" },
        { id: "team_2", name: "Ledger" },
      ],
      aliases: [{ id: "service", display: "Service" }],
      ...props,
    },
    global: { plugins: [i18n, store], stubs },
  });
}

type Wrapper = ReturnType<typeof render>;

async function addDimension(wrapper: Wrapper, name: string, value: string) {
  await wrapper.find('[data-test="oncall-simulator-add-dimension"]').trigger("click");
  await wrapper
    .findComponent('[data-test="oncall-simulator-dimension-name"]')
    .vm.$emit("update:modelValue", name);
  await wrapper.find('[data-test="oncall-simulator-dimension-value"]').setValue(value);
  await wrapper.find('[data-test="oncall-simulator-dimension-confirm"]').trigger("click");
}

describe("OnCallRoutingSimulator", () => {
  /// Nothing to test against means the button would ask the server "where does
  /// an alert with no facts go", which has no useful answer.
  it("cannot run with no dimensions", () => {
    expect(
      render().find('[data-test="oncall-simulator-run"]').attributes("disabled"),
    ).toBeDefined();
  });

  // The server lowercases before matching, so testing the un-normalised string
  // would answer a different question than the one asked.
  it("normalises a dimension the way the server will match it", async () => {
    const wrapper = render();
    await addDimension(wrapper, "service", "  Payments-API ");
    await wrapper.find('[data-test="oncall-simulator-run"]').trigger("click");

    expect(wrapper.emitted("run")?.[0][0]).toMatchObject({
      dimensions: { service: "payments-api" },
      priority: "P1",
    });
  });

  it("drops a dimension the reader removes", async () => {
    const wrapper = render();
    await addDimension(wrapper, "service", "api");
    expect(wrapper.find('[data-test="oncall-simulator-chip-service"]').exists()).toBe(true);

    await wrapper.find('[data-test="oncall-simulator-chip-service"] button').trigger("click");
    expect(wrapper.find('[data-test="oncall-simulator-chip-service"]').exists()).toBe(false);
  });

  it("shows the whole path — rule, team, ladder, person", () => {
    const wrapper = render({ preview: preview() });
    const result = wrapper.find('[data-test="oncall-simulator-result"]');

    expect(result.text()).toContain("service = payments-api");
    expect(wrapper.find('[data-test="oncall-simulator-team"]').text()).toContain("Payments");
    expect(wrapper.find('[data-test="oncall-simulator-ladder"]').text()).toContain("P1 ladder");
    expect(wrapper.find('[data-test="oncall-simulator-responder"]').text()).toContain("aarav@o2.ai");
  });

  /// "most specific of 1 match" is noise dressed as a finding.
  it("only claims specificity when something else actually matched", () => {
    expect(
      render({ preview: preview() }).find('[data-test="oncall-simulator-specificity"]').exists(),
    ).toBe(false);

    const contested = render({
      preview: preview({
        also_matched: [
          {
            rule_id: "r2",
            team_id: "team_1",
            path: "k8s-namespace=payments",
            same_team: true,
            lost_because: "a longer literal prefix wins",
          },
        ],
      }),
    });
    expect(contested.find('[data-test="oncall-simulator-specificity"]').text()).toContain("2");
  });

  /// A losing rule pointing at ANOTHER team is the case worth naming — that is
  /// a page that would have gone to a different set of phones.
  it("renders the server's reason a rule lost, and who it pointed at", () => {
    const wrapper = render({
      preview: preview({
        also_matched: [
          {
            rule_id: "r2",
            team_id: "team_2",
            team_name: "Ledger",
            path: "k8s-namespace=payments",
            same_team: false,
            lost_because: "`service=payments-api` pins a longer literal prefix",
          },
        ],
      }),
    });
    const line = wrapper.find('[data-test="oncall-simulator-also-r2"]');
    expect(line.text()).toContain("k8s-namespace = payments");
    expect(line.text()).toContain("Ledger");
    expect(line.text()).toContain("pins a longer literal prefix");
  });

  it("says plainly when nothing owns the dimensions", () => {
    const wrapper = render({ preview: preview({ team_id: null, decision: { kind: "unrouted" } }) });
    expect(wrapper.find('[data-test="oncall-simulator-team"]').text()).toContain("Nobody");
    // Nothing to page, so no test page can be offered.
    expect(wrapper.find('[data-test="oncall-simulator-send-test"]').exists()).toBe(false);
  });

  /// The reason a page would not land is the server's sentence — never a guess
  /// assembled here.
  it("gives the server's reason a responder cannot be reached", () => {
    const wrapper = render({
      preview: preview({
        current_responder: {
          user_email: "aarav@o2.ai",
          reason: "on call",
          would_a_page_land: false,
          why_not: "this deployment has no SMTP transport configured",
          deliverable_channels: [],
        },
      }),
    });
    expect(wrapper.find('[data-test="oncall-simulator-responder"]').text()).toContain(
      "no SMTP transport configured",
    );
  });

  it("marks a priority that would wake nobody", () => {
    const wrapper = render({
      preview: preview({
        ladder: [{ priority: "P1", rungs: 0, pages_anyone: false, ends_with_whole_team: false }],
      }),
    });
    expect(wrapper.find('[data-test="oncall-simulator-ladder"]').text()).toContain("Pages nobody");
  });

  it("asks the parent to send a real page for the resolved team", async () => {
    const wrapper = render({ preview: preview() });
    await wrapper.find('[data-test="oncall-simulator-send-test"]').trigger("click");
    expect(wrapper.emitted("send-test")?.[0][0]).toEqual({ team_id: "team_1", priority: "P1" });
  });
});
