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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OnCallOwnership from "@/components/oncall/OnCallOwnership.vue";
import { queryClient } from "@/composables/query/queryClient";
import { __resetOnCallRoutingConfig } from "@/composables/useOnCallRoutingConfig";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import serviceStreamsService from "@/services/service_streams";
import store from "@/test/unit/helpers/store";

const push = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push }),
}));
vi.mock("@/services/service_streams", () => ({
  default: {
    getSemanticGroups: vi.fn(),
    getServicesList: vi.fn(),
    getDimensionAnalytics: vi.fn(),
  },
}));
vi.mock("@/services/oncall", () => ({
  default: {
    ownershipStats: vi.fn(),
    createOwnershipRule: vi.fn(),
    updateOwnershipRule: vi.fn(),
    deleteOwnershipRule: vi.fn(),
    previewRouting: vi.fn(),
    unroutedSignals: vi.fn(),
    getRoutingConfig: vi.fn(),
    whoIsOnCall: vi.fn(),
  },
}));

const service = vi.mocked(oncallService);
const correlation = vi.mocked(serviceStreamsService);

/// The list and the editor are real: this file checks where they meet the tab.
const stubs = {
  ODialog: {
    name: "ODialog",
    props: ["open", "primaryButtonDisabled"],
    emits: ["update:open", "click:primary", "click:secondary"],
    template: "<div v-if='open'><slot /></div>",
  },
  ConfirmDialog: { name: "ConfirmDialog", props: ["modelValue", "okVariant"], template: "<div />" },
};

const TEAMS = [
  {
    id: "team_1",
    org_id: "default",
    name: "Platform",
    timezone: "UTC",
    created_at: 0,
    updated_at: 0,
  },
  {
    id: "team_2",
    org_id: "default",
    name: "Payments",
    timezone: "UTC",
    created_at: 0,
    updated_at: 0,
  },
];

function rule(id: string, teamId: string) {
  return {
    rule_id: id,
    team_id: teamId,
    path: `service=${id}`,
    dimensions: { service: id },
    created_at: 0,
    pages_caught: 4,
    last_matched_at: 1,
    health: "active",
    health_summary: "",
    shadowed_by: [],
  };
}

/// The table holds its skeleton for a moment after loading ends, so rows need that beat to appear.
async function settle() {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 60));
  await flushPromises();
}

function render() {
  return mount(OnCallOwnership, {
    props: { teamId: "team_1", teams: TEAMS },
    global: { plugins: [i18n, store], stubs },
  });
}

function routingConfig(defaultTeam: string | null) {
  service.getRoutingConfig.mockResolvedValue({
    data: { org_id: "default", default_team_id: defaultTeam, updated_at: 0 },
  } as never);
}

describe("OnCallOwnership", () => {
  beforeEach(() => {
    queryClient.clear();
    __resetOnCallRoutingConfig();
    vi.clearAllMocks();
    routingConfig(null);
    service.ownershipStats.mockResolvedValue({
      data: { rules: [rule("checkout", "team_1"), rule("moved", "team_2")], total: 2 },
    } as never);
    service.unroutedSignals.mockResolvedValue({ data: [] } as never);
    service.createOwnershipRule.mockResolvedValue({ data: {} } as never);
    service.whoIsOnCall.mockResolvedValue({ data: [] } as never);
    service.previewRouting.mockResolvedValue({ data: null } as never);
    correlation.getSemanticGroups.mockResolvedValue({ data: [] } as never);
    correlation.getServicesList.mockResolvedValue({ data: [] } as never);
    correlation.getDimensionAnalytics.mockResolvedValue({ data: { dimensions: [] } } as never);
  });

  it("titles the tab with the team and states the same precedence as org Routing", async () => {
    const wrapper = render();
    await settle();
    expect(wrapper.find('[data-test="oncall-ownership-title"]').text()).toBe(
      "Alerts that come to Platform",
    );
    const precedence = wrapper.find('[data-test="oncall-ownership-precedence"]');
    const text = String(i18n.global.t("oncall.routingPrecedence"));
    expect(precedence.attributes("tabindex")).toBe("0");
    expect(precedence.attributes("aria-label")).toBe(text);
    expect(
      wrapper.findAllComponents({ name: "OTooltip" }).some((c) => c.props("content") === text),
    ).toBe(true);
  });

  /// The org's list, the same entry org Routing reads, so Order is each rule's place in the org.
  it("reads the org's stats and lists only this team's rules", async () => {
    const wrapper = render();
    await settle();
    expect(service.ownershipStats).toHaveBeenCalledWith(
      expect.not.objectContaining({ team_id: expect.anything() }),
    );
    expect(wrapper.find('[data-test="oncall-routing-says-checkout"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-routing-says-moved"]').exists()).toBe(false);
  });

  it("reports the count the tab lists, so the header can agree with it", async () => {
    const wrapper = render();
    await settle();
    expect(wrapper.emitted("rules-loaded")?.[0]).toEqual([1]);
  });

  /// The team tab is the org list filtered, so a row offers the same Test, Edit and Delete.
  it("opens Test routing from a rule row, seeded with that rule", async () => {
    const wrapper = render();
    await settle();
    await wrapper.find('[data-test="oncall-routing-test-checkout"]').trigger("click");
    await settle();

    const simulator = wrapper.findComponent({ name: "OnCallRoutingSimulator" });
    expect(simulator.exists()).toBe(true);
    expect(simulator.props("seed")).toEqual({ service: "checkout" });
    simulator.vm.$emit("run", { dimensions: { service: "checkout" }, priority: "P1" });
    await flushPromises();
    expect(service.previewRouting).toHaveBeenCalledWith(
      expect.objectContaining({ data: { dimensions: { service: "checkout" } } }),
    );
  });

  it("shows the catch-all line only on the default team, pointing at Routing", async () => {
    routingConfig("team_1");
    const wrapper = render();
    await settle();
    await wrapper.find('[data-test="oncall-routing-catch-all-set"]').trigger("click");
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "onCallRouting" }));
  });

  it("links unclaimed signals to org Routing instead of listing them", async () => {
    service.unroutedSignals.mockResolvedValue({
      data: [
        { id: "s1", dimensions: { service: "a" }, occurrences: 1 },
        { id: "s2", dimensions: { service: "b" }, occurrences: 1 },
      ],
    } as never);
    const wrapper = render();
    await settle();
    const link = wrapper.find('[data-test="oncall-ownership-unclaimed"]');
    expect(link.text()).toBe("2 signals have no owner → Routing");
    await link.trigger("click");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "onCallRouting",
        query: expect.objectContaining({ tab: "signals" }),
      }),
    );
  });

  it("edits a rule in the same editor the org page uses", async () => {
    const wrapper = render();
    await settle();
    await wrapper.find('[data-test="oncall-routing-edit-checkout"]').trigger("click");
    await flushPromises();
    const editor = wrapper.findComponent({ name: "OnCallRuleEditor" });
    expect(editor.props("rule")).toMatchObject({ rule_id: "checkout" });
    editor.vm.$emit("save", { dimensions: { service: "checkout" }, team_id: "team_2" });
    await flushPromises();
    expect(service.updateOwnershipRule).toHaveBeenCalledWith(
      expect.objectContaining({ rule_id: "checkout" }),
    );
  });

  it("creates a new rule for this team by default", async () => {
    const wrapper = render();
    await settle();
    await wrapper.find('[data-test="oncall-ownership-add-rule"]').trigger("click");
    const editor = wrapper.findComponent({ name: "OnCallRuleEditor" });
    expect(editor.props("teamId")).toBe("team_1");
    editor.vm.$emit("save", { dimensions: { service: "x" }, team_id: "" });
    await flushPromises();
    expect(service.createOwnershipRule).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ team_id: "team_1" }) }),
    );
  });
});
