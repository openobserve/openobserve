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

/// The three sections are stubbed so this file is about the WIRING between
/// them and the API. Each one has its own spec for what it renders.
const stubs = {
  OnCallRoutingSimulator: {
    name: "OnCallRoutingSimulator",
    props: ["preview", "teamId", "teamName", "teams", "aliases", "loading", "sending"],
    template: "<div />",
  },
  OnCallOwnershipRules: {
    name: "OnCallOwnershipRules",
    props: ["rules", "aliases", "loading"],
    template: "<div />",
  },
  OnCallUnroutedQueue: {
    name: "OnCallUnroutedQueue",
    props: ["signals", "teamName", "loading", "claiming"],
    template: "<div />",
  },
  ODialog: { name: "ODialog", props: ["open", "primaryDisabled"], template: "<div><slot /></div>" },
  ConfirmDialog: { name: "ConfirmDialog", props: ["modelValue"], template: "<div />" },
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

const simulator = (w: Wrapper) => w.findComponent({ name: "OnCallRoutingSimulator" });
const rulesPanel = (w: Wrapper) => w.findComponent({ name: "OnCallOwnershipRules" });
const unrouted = (w: Wrapper) => w.findComponent({ name: "OnCallUnroutedQueue" });

async function typePair(wrapper: Wrapper, name: string, value: string) {
  // The name is chosen from the org's field vocabulary, not typed, so a rule
  // cannot be written against a dimension nothing emits.
  await wrapper
    .findComponent('[data-test="oncall-ownership-dimension-name"]')
    .vm.$emit("update:modelValue", name);
  await wrapper.find('[data-test="oncall-ownership-dimension-value"]').setValue(value);
  await wrapper.find('[data-test="oncall-ownership-add-dimension"]').trigger("click");
}

describe("OnCallOwnership", () => {
  beforeEach(() => {
    service.getRoutingConfig.mockResolvedValue({
      data: { org_id: "default", default_team_id: null, default_team_name: null, updated_at: 0 },
    } as any);
    vi.clearAllMocks();
    service.ownershipStats.mockResolvedValue({ data: { rules: [], total: 0 } } as any);
    service.unroutedSignals.mockResolvedValue({ data: [] } as any);
    service.createOwnershipRule.mockResolvedValue({ data: {} } as any);
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

  it("hands the fetched rules to the table", async () => {
    service.ownershipStats.mockResolvedValue({
      data: { total: 1, rules: [{ rule_id: "r1", path: "service=api", health: "active" }] },
    } as any);
    const wrapper = render();
    await flushPromises();
    expect(rulesPanel(wrapper).props("rules")).toHaveLength(1);
  });

  // The server lowercases rule values to match what the dimension extractor
  // produces. If the UI showed the raw input, a user would type PROD, read
  // back PROD, and get a rule that silently never matches.
  it("normalises a dimension value the way the server will store it", async () => {
    const wrapper = render();
    await flushPromises();
    await typePair(wrapper, "k8s-cluster", "  PROD ");
    expect(wrapper.text()).toContain("k8s-cluster=prod");
    expect(wrapper.text()).not.toContain("PROD");
  });

  it("sends the normalised dimensions to the API", async () => {
    const wrapper = render();
    await flushPromises();
    await typePair(wrapper, "k8s-cluster", "PROD");
    await typePair(wrapper, "k8s-namespace", "Payments");
    await wrapper.findComponent({ name: "ODialog" }).vm.$emit("click:primary");
    await flushPromises();

    expect(service.createOwnershipRule).toHaveBeenCalledWith({
      org_identifier: ORG,
      data: {
        team_id: "team_1",
        dimensions: { "k8s-cluster": "prod", "k8s-namespace": "payments" },
      },
    });
  });

  // A rule pinning the same dimension twice cannot mean anything, and the
  // second value would silently win.
  it("refuses a duplicate dimension name", async () => {
    const wrapper = render();
    await flushPromises();
    await typePair(wrapper, "k8s-cluster", "prod");
    await wrapper
      .findComponent('[data-test="oncall-ownership-dimension-name"]')
      .vm.$emit("update:modelValue", "k8s-cluster");
    await wrapper.find('[data-test="oncall-ownership-dimension-value"]').setValue("staging");

    expect(
      wrapper.find('[data-test="oncall-ownership-add-dimension"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("cannot save a rule with no dimensions", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.findComponent({ name: "ODialog" }).props("primaryDisabled")).toBe(true);

    await typePair(wrapper, "k8s-cluster", "prod");
    expect(wrapper.findComponent({ name: "ODialog" }).props("primaryDisabled")).toBe(false);
  });

  it("passes the routing preview back down to the simulator", async () => {
    service.previewRouting.mockResolvedValue({
      data: { decision: { kind: "ownership" }, team_id: "team_2", reason: "routed" },
    } as any);
    const wrapper = render();
    await flushPromises();

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
    service.testPage.mockResolvedValue({ data: { reached_anyone: true, recipients: ["a@o2.ai"] } } as any);
    const wrapper = render();
    await flushPromises();

    simulator(wrapper).vm.$emit("send-test", { team_id: "team_2", priority: "P3" });
    await flushPromises();

    expect(service.testPage).toHaveBeenCalledWith({
      org_identifier: ORG,
      team_id: "team_2",
      priority: 3,
    });
  });

  /// Claiming IS writing an ownership rule for the dimensions that went
  /// unmatched — there is no separate claim endpoint.
  it("claims an unrouted path by writing a rule for its exact dimensions", async () => {
    const signal = { id: "s1", dimensions: { service: "disputes-api" } };
    service.unroutedSignals.mockResolvedValue({ data: [signal] } as any);
    const wrapper = render();
    await flushPromises();

    unrouted(wrapper).vm.$emit("claim", signal);
    await flushPromises();

    expect(service.createOwnershipRule).toHaveBeenCalledWith({
      org_identifier: ORG,
      data: { team_id: "team_1", dimensions: { service: "disputes-api" } },
    });
    // Both lists move: the rule appears and the signal stops being unrouted.
    expect(service.ownershipStats).toHaveBeenCalledTimes(2);
    expect(service.unroutedSignals).toHaveBeenCalledTimes(2);
  });

  /// One already-covered path must not abandon the rest of the queue.
  it("keeps claiming after one path fails", async () => {
    service.unroutedSignals.mockResolvedValue({
      data: [
        { id: "s1", dimensions: { service: "a" } },
        { id: "s2", dimensions: { service: "b" } },
      ],
    } as any);
    service.createOwnershipRule
      .mockRejectedValueOnce(new Error("duplicate"))
      .mockResolvedValueOnce({ data: {} } as any);

    const wrapper = render();
    await flushPromises();
    unrouted(wrapper).vm.$emit("claim-all");
    await flushPromises();
    await wrapper.findAllComponents({ name: "ConfirmDialog" })[1].vm.$emit("update:ok");
    await flushPromises();

    expect(service.createOwnershipRule).toHaveBeenCalledTimes(2);
  });

  it("deletes a rule by its rule id", async () => {
    service.deleteOwnershipRule.mockResolvedValue({ data: {} } as any);
    const wrapper = render();
    await flushPromises();

    rulesPanel(wrapper).vm.$emit("remove", { rule_id: "r9" });
    await wrapper.vm.$nextTick();
    await wrapper.findAllComponents({ name: "ConfirmDialog" })[0].vm.$emit("update:ok");
    await flushPromises();

    expect(service.deleteOwnershipRule).toHaveBeenCalledWith({
      org_identifier: ORG,
      rule_id: "r9",
    });
  });

  /// A team with no unrouted traffic and a server without the endpoint look
  /// identical from here, and neither deserves an error.
  it("survives an unrouted endpoint that is not there", async () => {
    service.unroutedSignals.mockRejectedValue(new Error("404"));
    const wrapper = render();
    await flushPromises();
    expect(unrouted(wrapper).props("signals")).toEqual([]);
  });
  /// C10 — tier 4 of routing. Nothing auto-creates a default, so the unset
  /// state IS the warning: without a nomination an unowned signal pages
  /// nobody, and it lands in the queue this card sits directly above.
  describe("the default team", () => {
    async function renderLoaded() {
      const wrapper = render();
      await flushPromises();
      return wrapper;
    }

    it("warns when no default team is nominated", async () => {
      const wrapper = await renderLoaded();
      expect(wrapper.find('[data-test="oncall-default-team-unset"]').exists()).toBe(true);
    });

    it("shows the nomination and stops warning once one exists", async () => {
      service.getRoutingConfig.mockResolvedValue({
        data: { org_id: "default", default_team_id: "team_1", default_team_name: "Platform", updated_at: 1 },
      } as any);
      const wrapper = await renderLoaded();
      expect(wrapper.find('[data-test="oncall-default-team-unset"]').exists()).toBe(false);
    });

    it("nominates a team", async () => {
      service.setRoutingConfig.mockResolvedValue({
        data: { org_id: "default", default_team_id: "team_1", default_team_name: "Platform", updated_at: 1 },
      } as any);
      const wrapper = await renderLoaded();

      wrapper
        .findComponent('[data-test="oncall-default-team-select"]')
        .vm.$emit("update:modelValue", "team_1");
      await flushPromises();
      await wrapper.find('[data-test="oncall-default-team-save"]').trigger("click");
      await flushPromises();

      expect(service.setRoutingConfig).toHaveBeenCalledWith(
        expect.objectContaining({ data: { default_team_id: "team_1" } }),
      );
    });

    /// Clearing sends null, not "" — the picker's empty string is a UI
    /// vocabulary the wire never sees.
    it("clears by sending null", async () => {
      service.getRoutingConfig.mockResolvedValue({
        data: { org_id: "default", default_team_id: "team_1", default_team_name: "Platform", updated_at: 1 },
      } as any);
      service.setRoutingConfig.mockResolvedValue({
        data: { org_id: "default", default_team_id: null, default_team_name: null, updated_at: 2 },
      } as any);
      const wrapper = await renderLoaded();

      wrapper
        .findComponent('[data-test="oncall-default-team-select"]')
        .vm.$emit("update:modelValue", "");
      await flushPromises();
      await wrapper.find('[data-test="oncall-default-team-save"]').trigger("click");
      await flushPromises();

      expect(service.setRoutingConfig).toHaveBeenCalledWith(
        expect.objectContaining({ data: { default_team_id: null } }),
      );
    });
  });

});
