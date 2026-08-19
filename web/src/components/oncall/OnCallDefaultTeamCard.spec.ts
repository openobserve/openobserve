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

import OnCallDefaultTeamCard from "@/components/oncall/OnCallDefaultTeamCard.vue";
import { __resetOnCallRoutingConfig } from "@/composables/useOnCallRoutingConfig";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/oncall", () => ({
  default: { getRoutingConfig: vi.fn(), setRoutingConfig: vi.fn() },
}));

const service = vi.mocked(oncallService);
const ORG = store.state.selectedOrganization.identifier;
const TEAMS = [{ id: "team_1", name: "Platform" }];

const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OButton: { name: "OButton", props: ["variant"], template: "<button><slot /></button>" },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options"],
    emits: ["update:modelValue"],
    template: "<select />",
  },
  ODialog: {
    name: "ODialog",
    props: ["open", "title", "primaryButtonLabel", "primaryButtonDisabled"],
    emits: ["click:primary", "update:open"],
    template: "<div><slot /></div>",
  },
};

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallDefaultTeamCard, {
    props: { teams: TEAMS, ...props },
    global: { plugins: [i18n, store], stubs },
  });
}

const dialog = (w: ReturnType<typeof render>) => w.findComponent({ name: "ODialog" });

describe("OnCallDefaultTeamCard", () => {
  beforeEach(() => {
    // The catch-all is cached module-wide so one screen reads it once;
    // without this it survives into the next test.
    __resetOnCallRoutingConfig();
    vi.clearAllMocks();
    service.getRoutingConfig.mockResolvedValue({ data: { default_team_id: null } } as any);
    service.setRoutingConfig.mockResolvedValue({ data: { default_team_id: "team_1" } } as any);
  });

  /// The one-time act is behind a click; the standing fact is not. An org with
  /// no catch-all has to read that off the trigger itself.
  it("names the current catch-all on the trigger, or that there is none", async () => {
    const unset = render({ dialog: true });
    await flushPromises();
    expect(unset.find('[data-test="oncall-default-team-open"]').text()).toContain(
      "Set a catch-all team",
    );

    // Two mounts, two answers — so the shared read has to be dropped between
    // them. Reusing it is the composable working: one screen, one request.
    __resetOnCallRoutingConfig();
    service.getRoutingConfig.mockResolvedValue({ data: { default_team_id: "team_1" } } as any);
    const set = render({ dialog: true });
    await flushPromises();
    expect(set.find('[data-test="oncall-default-team-open"]').text()).toContain(
      "Catch-all team: Platform",
    );
  });

  it("saves the nomination from the modal and closes it", async () => {
    const wrapper = render({ dialog: true });
    await flushPromises();
    await wrapper.find('[data-test="oncall-default-team-open"]').trigger("click");
    expect(dialog(wrapper).props("open")).toBe(true);
    // Nothing chosen yet — there is nothing to save.
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(true);

    wrapper.findComponent({ name: "OSelect" }).vm.$emit("update:modelValue", "team_1");
    await flushPromises();
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(false);

    dialog(wrapper).vm.$emit("click:primary");
    await flushPromises();
    expect(service.setRoutingConfig).toHaveBeenCalledWith({
      org_identifier: ORG,
      data: { default_team_id: "team_1" },
    });
    expect(dialog(wrapper).props("open")).toBe(false);
  });

  /// A cancelled edit must not come back as the next draft.
  it("reseeds the picker from the saved value each time it opens", async () => {
    const wrapper = render({ dialog: true });
    await flushPromises();
    await wrapper.find('[data-test="oncall-default-team-open"]').trigger("click");
    wrapper.findComponent({ name: "OSelect" }).vm.$emit("update:modelValue", "team_1");
    dialog(wrapper).vm.$emit("update:open", false);
    await flushPromises();

    await wrapper.find('[data-test="oncall-default-team-open"]').trigger("click");
    expect(wrapper.findComponent({ name: "OSelect" }).props("modelValue")).toBe("");
  });

  /// The card is still the team-less default: hosts that have room for it are
  /// unaffected by the dialog mode.
  it("still renders as a card when the host has room for one", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-default-team-card"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-default-team-open"]').exists()).toBe(false);
  });
});
