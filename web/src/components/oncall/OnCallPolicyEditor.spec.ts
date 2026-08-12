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

import OnCallPolicyEditor from "@/components/oncall/OnCallPolicyEditor.vue";
import i18n from "@/locales";
import destinationService from "@/services/alert_destination";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import type { OnCallPolicy } from "@/ts/interfaces/oncall";

vi.mock("@/services/oncall", () => ({
  default: { setPolicy: vi.fn(), listMembers: vi.fn(), whoIsOnCall: vi.fn() },
}));
vi.mock("@/services/alert_destination", () => ({ default: { list: vi.fn() } }));

const service = vi.mocked(oncallService);
const destinations = vi.mocked(destinationService);

const stubs = {
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OButton: {
    name: "OButton",
    props: ["disabled"],
    template: `<button :disabled="disabled"><slot /></button>`,
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options"],
    emits: ["update:modelValue"],
    template: "<select />",
  },
  OCheckbox: {
    name: "OCheckbox",
    props: ["modelValue", "label"],
    template: `<label><input type="checkbox" :checked="modelValue" />{{ label }}</label>`,
  },
};

const policy: OnCallPolicy = {
  id: "pol_1",
  org_id: "default",
  team_id: "team_1",
  rungs: [
    { priority: 1, steps: [{ level: "primary", after_micros: 0 }], channels: ["email"] },
    { priority: 4, steps: [], channels: [] },
  ],
};

function render() {
  return mount(OnCallPolicyEditor, {
    props: { teamId: "team_1", policy },
    global: { plugins: [i18n, store], stubs },
  });
}

describe("OnCallPolicyEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.setPolicy.mockResolvedValue({ data: {} } as any);
  });

  // A checkbox for a channel nothing can send lets somebody tick SMS and
  // receive nothing, with no error — the worst failure a pager can have.
  it("offers only channels that can actually be delivered", async () => {
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-policy-channel-1-email"]').exists()).toBe(true);
    for (const unimplemented of ["sms", "voice", "chat", "push", "in_app"]) {
      expect(
        wrapper.find(`[data-test="oncall-policy-channel-1-${unimplemented}"]`).exists(),
        `${unimplemented} has no Notifier and must not be offered`,
      ).toBe(false);
    }
  });

  // The short list should read as deliberate, not as something missing.
  it("says why the other channels are absent", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("not implemented yet");
  });

  it("shows a non-paging priority as paging nobody", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("Pages nobody");
  });

  /// Ticking `webhook` says HOW to page; the destination says WHERE. Offering
  /// the channel without the target lets someone turn on a page that silently
  /// reaches nobody.
  describe("webhook destinations", () => {
    beforeEach(() => {
      destinations.list.mockResolvedValue({
        data: [{ name: "slack-oncall" }, { name: "pagerduty" }],
      } as any);
    });

    const webhookPolicy: OnCallPolicy = {
      ...policy,
      rungs: [
        { priority: 1, steps: [{ level: "primary", after_micros: 0 }], channels: ["webhook"] },
      ],
      destinations: ["slack-oncall"],
    };

    it("hides the picker when nothing pages by webhook", async () => {
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-policy-destinations"]').exists()).toBe(false);
    });

    it("warns when the webhook channel has nowhere to go", async () => {
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy: { ...webhookPolicy, destinations: [] } },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();

      expect(
        wrapper.find('[data-test="oncall-policy-destinations-warning"]').text(),
      ).toContain("reach nobody");
    });

    it("does not warn once a destination is chosen", async () => {
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy: webhookPolicy },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-policy-destinations-warning"]').exists()).toBe(
        false,
      );
    });

    it("saves the destinations alongside the rungs", async () => {
      service.setPolicy.mockResolvedValue({ data: {} } as any);
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy: webhookPolicy },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();

      await wrapper.find('[data-test="oncall-policy-save"]').trigger("click");
      await flushPromises();

      expect(service.setPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ destinations: ["slack-oncall"] }),
        }),
      );
    });

    /// The editor is still worth using when the destination list is unreachable.
    it("still renders when destinations cannot be loaded", async () => {
      destinations.list.mockRejectedValue(new Error("boom"));
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy: webhookPolicy },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-policy-save"]').exists()).toBe(true);
    });
  });

  /// A ladder built out of target kinds does not answer "who does this wake".
  it("names the people a rung would actually reach", async () => {
    service.whoIsOnCall.mockResolvedValue({
      data: [{ rotation: "Weekdays", user_email: "ana@o2.ai", next_user_email: "bob@o2.ai" }],
    } as any);
    const wrapper = mount(OnCallPolicyEditor, {
      props: {
        teamId: "team_1",
        policy: {
          ...policy,
          rungs: [
            {
              priority: 1,
              channels: ["email"],
              steps: [{ after_micros: 0, targets: [{ kind: "on_call_now" }] }],
            },
          ],
        },
      },
      global: { plugins: [i18n, store], stubs },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-policy-preview-1"]').text()).toContain("ana@o2.ai");
  });

  /// The failure worth seeing before a save: configured, and wakes nobody.
  it("warns when a rung resolves to nobody", async () => {
    service.whoIsOnCall.mockResolvedValue({
      data: [{ rotation: "Solo", user_email: "ana@o2.ai", next_user_email: null }],
    } as any);
    const wrapper = mount(OnCallPolicyEditor, {
      props: {
        teamId: "team_1",
        policy: {
          ...policy,
          rungs: [
            {
              priority: 1,
              channels: ["email"],
              steps: [{ after_micros: 0, targets: [{ kind: "next_on_call" }] }],
            },
          ],
        },
      },
      global: { plugins: [i18n, store], stubs },
    });
    await flushPromises();

    expect(
      wrapper.find('[data-test="oncall-policy-preview-nobody-1-0"]').exists(),
    ).toBe(true);
  });
});
