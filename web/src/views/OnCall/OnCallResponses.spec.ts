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

import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import OnCallResponses from "@/views/OnCall/OnCallResponses.vue";

vi.mock("@/services/oncall", () => ({
  default: { listResponses: vi.fn(), listTeams: vi.fn() },
}));

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const service = vi.mocked(oncallService);

const stubs = {
  OPageLayout: { name: "OPageLayout", template: "<div><slot name='actions' /><slot /></div>" },
  OTable: { name: "OTable", template: "<div><slot name='empty' /></div>" },
  OEmptyState: { name: "OEmptyState", props: ["preset"], template: "<div :data-preset='preset' />" },
  OSelect: { name: "OSelect", template: "<select />" },
  OSearchInput: { name: "OSearchInput", template: "<input />" },
  OTooltip: { name: "OTooltip", template: "<span />" },
  OButton: {
    name: "OButton",
    template: `<button @click="$emit('click')"><slot /></button>`,
  },
};

const team = {
  id: "team_1",
  org_id: "default",
  name: "Platform",
  timezone: "UTC",
  created_at: 0,
  updated_at: 0,
};

function render() {
  return mount(OnCallResponses, { global: { plugins: [i18n, store], stubs } });
}

describe("OnCallResponses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.listResponses.mockResolvedValue({ data: [] } as any);
  });

  // The bug this pins: "Nothing is paging" is only reassuring once something
  // COULD page. On a fresh install it is indistinguishable from "nothing is
  // set up", and the page offered no way forward.
  it("shows the setup guide when the org has no teams", async () => {
    service.listTeams.mockResolvedValue({ data: [] } as any);
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-setup-guide"]').exists()).toBe(true);
    expect(wrapper.find('[data-preset="no-oncall-responses"]').exists()).toBe(false);
  });

  it("shows the calm empty state once a team exists", async () => {
    service.listTeams.mockResolvedValue({ data: [team] } as any);
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-setup-guide"]').exists()).toBe(false);
    expect(wrapper.find('[data-preset="no-oncall-responses"]').exists()).toBe(true);
  });

  // A guide that flashes on every load would read as "your setup vanished".
  it("does not show the guide before the first fetch resolves", () => {
    service.listTeams.mockReturnValue(new Promise(() => {}) as any);
    const wrapper = render();
    expect(wrapper.find('[data-test="oncall-setup-guide"]').exists()).toBe(false);
  });

  it("always offers a route to Teams", async () => {
    service.listTeams.mockResolvedValue({ data: [team] } as any);
    const wrapper = render();
    await flushPromises();

    await wrapper.find('[data-test="oncall-responses-teams-btn"]').trigger("click");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: "onCallTeams" }),
    );
  });

  // A failed fetch must not be mistaken for an empty org and answered with a
  // setup guide the user does not need.
  it("does not show the guide when the fetch failed", async () => {
    service.listTeams.mockRejectedValue(new Error("boom"));
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-setup-guide"]').exists()).toBe(false);
  });
});
