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

vi.mock("@/services/oncall", () => ({
  default: {
    listOwnershipRules: vi.fn(),
    createOwnershipRule: vi.fn(),
    deleteOwnershipRule: vi.fn(),
    previewRouting: vi.fn(),
  },
}));

const service = vi.mocked(oncallService);

const stubs = {
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OIcon: { name: "OIcon", template: "<i />" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  ConfirmDialog: { name: "ConfirmDialog", template: "<div />" },
  OButton: {
    name: "OButton",
    props: ["disabled"],
    // No `@click="$emit('click')"`: the parent's handler already falls through
    // to the native button, and re-emitting fires it twice.
    template: `<button :disabled="disabled"><slot /></button>`,
  },
  OInput: {
    name: "OInput",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: `<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
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

async function typePair(wrapper: ReturnType<typeof render>, name: string, value: string) {
  await wrapper.find('[data-test="oncall-ownership-dimension-name"]').setValue(name);
  await wrapper.find('[data-test="oncall-ownership-dimension-value"]').setValue(value);
  await wrapper.find('[data-test="oncall-ownership-add-dimension"]').trigger("click");
}

describe("OnCallOwnership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.listOwnershipRules.mockResolvedValue({ data: [] } as any);
    service.createOwnershipRule.mockResolvedValue({ data: {} } as any);
  });

  it("lists a team's rules in canonical path form", async () => {
    service.listOwnershipRules.mockResolvedValue({
      data: [
        {
          id: "r1",
          org_id: "default",
          team_id: "team_1",
          // Deliberately reversed: the path must sort, not echo insertion order.
          dimensions: { "k8s-namespace": "payments", "k8s-cluster": "prod" },
          created_at: 0,
          updated_at: 0,
        },
      ],
    } as any);
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("k8s-cluster=prod/k8s-namespace=payments");
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
    await wrapper.find('[data-test="oncall-ownership-save"]').trigger("click");
    await flushPromises();

    expect(service.createOwnershipRule).toHaveBeenCalledWith({
      org_identifier: store.state.selectedOrganization.identifier,
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
    await wrapper.find('[data-test="oncall-ownership-dimension-name"]').setValue("k8s-cluster");
    await wrapper.find('[data-test="oncall-ownership-dimension-value"]').setValue("staging");

    const addButton = wrapper.find('[data-test="oncall-ownership-add-dimension"]');
    expect(addButton.attributes("disabled")).toBeDefined();
  });

  it("cannot save a rule with no dimensions", async () => {
    const wrapper = render();
    await flushPromises();
    expect(
      wrapper.find('[data-test="oncall-ownership-save"]').attributes("disabled"),
    ).toBeDefined();

    await typePair(wrapper, "k8s-cluster", "prod");
    expect(
      wrapper.find('[data-test="oncall-ownership-save"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("names the winning team and the reason when routing is tested", async () => {
    service.previewRouting.mockResolvedValue({
      data: {
        decision: { kind: "ownership" },
        team_id: "team_2",
        reason: "routed to team_2 by ownership rule k8s-cluster=prod",
      },
    } as any);
    const wrapper = render();
    await flushPromises();

    await wrapper.find('[data-test="oncall-routing-test-name"]').setValue("k8s-cluster");
    await wrapper.find('[data-test="oncall-routing-test-value"]').setValue("prod");
    await wrapper.find('[data-test="oncall-routing-test-add"]').trigger("click");
    await wrapper.find('[data-test="oncall-routing-test-run"]').trigger("click");
    await flushPromises();

    const result = wrapper.find('[data-test="oncall-routing-test-result"]');
    expect(result.exists()).toBe(true);
    // The team's NAME, not the raw id — an id tells a reader nothing.
    expect(result.text()).toContain("Payments");
    expect(result.text()).toContain("by ownership rule k8s-cluster=prod");
  });

  // An unrouted result is the one worth surfacing loudly: it means an alert
  // matching these dimensions would page nobody.
  it("says nobody would be paged when routing finds no owner", async () => {
    service.previewRouting.mockResolvedValue({
      data: {
        decision: { kind: "unrouted" },
        team_id: null,
        reason: "no ownership rule matches this signal, so no team was paged",
      },
    } as any);
    const wrapper = render();
    await flushPromises();

    await wrapper.find('[data-test="oncall-routing-test-name"]').setValue("k8s-cluster");
    await wrapper.find('[data-test="oncall-routing-test-value"]').setValue("staging");
    await wrapper.find('[data-test="oncall-routing-test-add"]').trigger("click");
    await wrapper.find('[data-test="oncall-routing-test-run"]').trigger("click");
    await flushPromises();

    const result = wrapper.find('[data-test="oncall-routing-test-result"]');
    expect(result.text()).toContain("Nobody");
    expect(result.text()).toContain("no team owns this signal");
  });
});
