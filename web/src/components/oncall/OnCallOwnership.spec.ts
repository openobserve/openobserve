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
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/alerts", () => ({
  default: { getSemanticGroups: vi.fn() },
}));
vi.mock("@/services/oncall", () => ({
  default: {
    ownershipStats: vi.fn(),
    createOwnershipRule: vi.fn(),
    updateOwnershipRule: vi.fn(),
    deleteOwnershipRule: vi.fn(),
    previewRouting: vi.fn(),
    unroutedSignals: vi.fn(),
    dismissUnroutedSignal: vi.fn(),
    testPage: vi.fn(),
    getRoutingConfig: vi.fn(),
    setRoutingConfig: vi.fn(),
  },
}));

const service = vi.mocked(oncallService);
const ORG = store.state.selectedOrganization.identifier;

/// The list and the tester are stubbed so this file is about the WIRING
/// between them and the API. Each one has its own spec for what it renders.
const stubs = {
  OnCallRoutingList: {
    name: "OnCallRoutingList",
    props: [
      "rules",
      "signals",
      "aliases",
      "teamId",
      "teamName",
      "teams",
      "defaultTeamId",
      "onCallNow",
      "ladder",
      "loading",
      "saving",
      "savingDefault",
      "claiming",
      "testerOpen",
    ],
    template: "<div />",
  },
  OnCallRoutingSimulator: {
    name: "OnCallRoutingSimulator",
    props: ["preview", "teamId", "teamName", "teams", "aliases", "loading", "sending"],
    template: "<div />",
  },
  ConfirmDialog: { name: "ConfirmDialog", props: ["modelValue"], template: "<div />" },
};

function render() {
  return mount(OnCallOwnership, {
    props: {
      teamId: "team_1",
      teams: [
        { id: "team_1", org_id: "default", name: "Platform", timezone: "UTC", created_at: 0, updated_at: 0 },
        { id: "team_2", org_id: "default", name: "Payments", timezone: "UTC", created_at: 0, updated_at: 0 },
      ],
    },
    global: { plugins: [i18n, store], stubs },
  });
}

type Wrapper = ReturnType<typeof render>;

const list = (w: Wrapper) => w.findComponent({ name: "OnCallRoutingList" });
const simulator = (w: Wrapper) => w.findComponent({ name: "OnCallRoutingSimulator" });

describe("OnCallOwnership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getRoutingConfig.mockResolvedValue({
      data: { org_id: "default", default_team_id: null, default_team_name: null, updated_at: 0 },
    } as any);
    service.ownershipStats.mockResolvedValue({ data: { rules: [], total: 0 } } as any);
    service.unroutedSignals.mockResolvedValue({ data: [] } as any);
    service.createOwnershipRule.mockResolvedValue({ data: {} } as any);
    service.updateOwnershipRule.mockResolvedValue({ data: {} } as any);
  });

  /// Scoped to this team: the org-wide stats endpoint would otherwise show
  /// another team's rules on this team's screen.
  it("asks for only this team's rules", async () => {
    render();
    await flushPromises();
    expect(service.ownershipStats).toHaveBeenCalledWith({
      org_identifier: ORG,
      team_id: "team_1",
    });
  });

  it("hands the fetched rules and signals to the list", async () => {
    service.ownershipStats.mockResolvedValue({
      data: { total: 1, rules: [{ rule_id: "r1", path: "service=api", health: "active" }] },
    } as any);
    service.unroutedSignals.mockResolvedValue({ data: [{ id: "s1", dimensions: {} }] } as any);
    const wrapper = render();
    await flushPromises();
    expect(list(wrapper).props("rules")).toHaveLength(1);
    expect(list(wrapper).props("signals")).toHaveLength(1);
  });

  /// The catch-all is a row of the same list now, so the nomination has to
  /// reach it from here rather than from a card that fetches its own copy.
  it("passes the nominated catch-all down to the list", async () => {
    service.getRoutingConfig.mockResolvedValue({
      data: { org_id: "default", default_team_id: "team_2", default_team_name: "Payments", updated_at: 1 },
    } as any);
    const wrapper = render();
    await flushPromises();
    expect(list(wrapper).props("defaultTeamId")).toBe("team_2");
  });

  it("creates a rule from the editor's draft", async () => {
    const wrapper = render();
    await flushPromises();

    list(wrapper).vm.$emit("save-rule", {
      dimensions: { "k8s-cluster": "prod" },
      team_id: "team_1",
      rule: null,
    });
    await flushPromises();

    expect(service.createOwnershipRule).toHaveBeenCalledWith({
      org_identifier: ORG,
      data: { team_id: "team_1", dimensions: { "k8s-cluster": "prod" } },
    });
    expect(service.deleteOwnershipRule).not.toHaveBeenCalled();
  });

  /// A rule can be handed to another team from this screen — that is the
  /// common correction, and the alternative is deleting and re-writing it.
  it("honours a draft that routes to a different team", async () => {
    const wrapper = render();
    await flushPromises();

    list(wrapper).vm.$emit("save-rule", {
      dimensions: { service: "api" },
      team_id: "team_2",
      rule: null,
    });
    await flushPromises();

    expect(service.createOwnershipRule).toHaveBeenCalledWith({
      org_identifier: ORG,
      data: { team_id: "team_2", dimensions: { service: "api" } },
    });
  });

  /// An edit used to create the replacement and then delete the original, so
  /// that the path was never owned by nobody. The server refuses that now —
  /// the create is a duplicate while the original still holds the path — which
  /// broke repointing a rule, the exact correction the route exists for.
  it("edits in place rather than creating a duplicate of the same path", async () => {
    const wrapper = render();
    await flushPromises();
    list(wrapper).vm.$emit("save-rule", {
      dimensions: { service: "api" },
      team_id: "team_2",
      rule: { rule_id: "r9" },
    });
    await flushPromises();

    expect(service.updateOwnershipRule).toHaveBeenCalledWith({
      org_identifier: ORG,
      rule_id: "r9",
      data: { team_id: "team_2", dimensions: { service: "api" } },
    });
    expect(service.createOwnershipRule).not.toHaveBeenCalled();
    expect(service.deleteOwnershipRule).not.toHaveBeenCalled();
  });

  it("deletes a rule by its rule id once confirmed", async () => {
    service.deleteOwnershipRule.mockResolvedValue({ data: {} } as any);
    const wrapper = render();
    await flushPromises();

    list(wrapper).vm.$emit("remove", { rule_id: "r9" });
    await wrapper.vm.$nextTick();
    await wrapper.findAllComponents({ name: "ConfirmDialog" })[0].vm.$emit("update:ok");
    await flushPromises();

    expect(service.deleteOwnershipRule).toHaveBeenCalledWith({
      org_identifier: ORG,
      rule_id: "r9",
    });
  });

  /// C10 — tier 4 of routing. Nothing auto-creates a default, and the picker's
  /// empty string is a UI vocabulary the wire never sees.
  describe("the catch-all team", () => {
    it("nominates a team", async () => {
      service.setRoutingConfig.mockResolvedValue({
        data: { org_id: "default", default_team_id: "team_1", default_team_name: "Platform", updated_at: 1 },
      } as any);
      const wrapper = render();
      await flushPromises();

      list(wrapper).vm.$emit("set-default", "team_1");
      await flushPromises();

      expect(service.setRoutingConfig).toHaveBeenCalledWith(
        expect.objectContaining({ data: { default_team_id: "team_1" } }),
      );
      expect(list(wrapper).props("defaultTeamId")).toBe("team_1");
    });

    it("clears by sending null", async () => {
      service.setRoutingConfig.mockResolvedValue({
        data: { org_id: "default", default_team_id: null, default_team_name: null, updated_at: 2 },
      } as any);
      const wrapper = render();
      await flushPromises();

      list(wrapper).vm.$emit("set-default", null);
      await flushPromises();

      expect(service.setRoutingConfig).toHaveBeenCalledWith(
        expect.objectContaining({ data: { default_team_id: null } }),
      );
    });
  });

  /// One already-covered path must not abandon the rest of the queue.
  it("keeps claiming after one path fails", async () => {
    service.unroutedSignals.mockResolvedValue({
      data: [
        { id: "s1", dimensions: { service: "a" }, occurrences: 1 },
        { id: "s2", dimensions: { service: "b" }, occurrences: 1 },
      ],
    } as any);
    service.createOwnershipRule
      .mockRejectedValueOnce(new Error("duplicate"))
      .mockResolvedValueOnce({ data: {} } as any);

    const wrapper = render();
    await flushPromises();
    list(wrapper).vm.$emit("claim-all");
    await wrapper.vm.$nextTick();
    await wrapper.findAllComponents({ name: "ConfirmDialog" })[1].vm.$emit("update:ok");
    await flushPromises();

    expect(service.createOwnershipRule).toHaveBeenCalledTimes(2);
  });

  /// A dismissed row is the historical record, not the worklist — claiming
  /// everything must not re-claim what somebody already ruled out.
  it("leaves dismissed signals out of a bulk claim", async () => {
    service.unroutedSignals.mockResolvedValue({
      data: [
        { id: "s1", dimensions: { service: "a" }, occurrences: 1 },
        { id: "s2", dimensions: { service: "b" }, occurrences: 1, dismissed_at: 5 },
      ],
    } as any);

    const wrapper = render();
    await flushPromises();
    list(wrapper).vm.$emit("claim-all");
    await wrapper.vm.$nextTick();
    await wrapper.findAllComponents({ name: "ConfirmDialog" })[1].vm.$emit("update:ok");
    await flushPromises();

    expect(service.createOwnershipRule).toHaveBeenCalledTimes(1);
    expect(service.createOwnershipRule).toHaveBeenCalledWith({
      org_identifier: ORG,
      data: { team_id: "team_1", dimensions: { service: "a" } },
    });
  });

  it("dismisses a signal by its id", async () => {
    service.dismissUnroutedSignal.mockResolvedValue({ data: {} } as any);
    const wrapper = render();
    await flushPromises();

    list(wrapper).vm.$emit("dismiss", { id: "s7" });
    await flushPromises();

    expect(service.dismissUnroutedSignal).toHaveBeenCalledWith({
      org_identifier: ORG,
      signal_id: "s7",
    });
  });

  /// The tester no longer leads the screen: it asks the reader to describe a
  /// hypothetical alert before they have seen a rule.
  it("keeps the tester closed until it is asked for", async () => {
    const wrapper = render();
    await flushPromises();
    expect(simulator(wrapper).exists()).toBe(false);

    list(wrapper).vm.$emit("toggle-tester");
    await wrapper.vm.$nextTick();
    expect(simulator(wrapper).exists()).toBe(true);
  });

  it("passes the routing preview back down to the tester", async () => {
    service.previewRouting.mockResolvedValue({
      data: { decision: { kind: "ownership" }, team_id: "team_2", reason: "routed" },
    } as any);
    const wrapper = render();
    await flushPromises();
    list(wrapper).vm.$emit("toggle-tester");
    await wrapper.vm.$nextTick();

    simulator(wrapper).vm.$emit("run", { dimensions: { service: "api" }, priority: "P1" });
    await flushPromises();

    expect(service.previewRouting).toHaveBeenCalledWith({
      org_identifier: ORG,
      data: { dimensions: { service: "api" } },
    });
    expect(simulator(wrapper).props("preview")).toMatchObject({ team_id: "team_2" });
  });

  /// The API takes a number; the simulator speaks in "P1".
  it("sends a real test page with the priority as a number", async () => {
    service.testPage.mockResolvedValue({
      data: {
        reached_anyone: true,
        channels: ["email"],
        attempts: [{ channel: "email", recipient: "a@o2.ai", reason: "on call now", delivered: true }],
      },
    } as any);
    const wrapper = render();
    await flushPromises();
    list(wrapper).vm.$emit("toggle-tester");
    await wrapper.vm.$nextTick();

    simulator(wrapper).vm.$emit("send-test", { team_id: "team_2", priority: "P3" });
    await flushPromises();

    expect(service.testPage).toHaveBeenCalledWith({
      org_identifier: ORG,
      team_id: "team_2",
      priority: 3,
    });
  });

  /// A team with no unrouted traffic and a server without the endpoint look
  /// identical from here, and neither deserves an error.
  it("survives an unrouted endpoint that is not there", async () => {
    service.unroutedSignals.mockRejectedValue(new Error("404"));
    const wrapper = render();
    await flushPromises();
    expect(list(wrapper).props("signals")).toEqual([]);
  });
});
