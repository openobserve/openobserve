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
import OnCallMine from "@/views/OnCall/OnCallMine.vue";

vi.mock("@/services/oncall", () => ({ default: { myOnCall: vi.fn() } }));

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const service = vi.mocked(oncallService);

// The page's Refresh calls this through a template ref; the stub has to expose it or that call throws.
const deliveriesRefresh = vi.fn().mockResolvedValue(undefined);

const stubs = {
  OPageLayout: { name: "OPageLayout", template: "<div><slot name='actions' /><slot /></div>" },
  OContent: { name: "OContent", template: "<div><slot /></div>" },
  OEmptyState: { name: "OEmptyState", template: "<div />" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OButton: { name: "OButton", template: "<button><slot /></button>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  // Stubbed out: it reads its own endpoint, which this spec's service mock does
  // not carry, and its fetch would throw into its own catch for the wrong reason.
  OnCallMyDeliveries: {
    name: "OnCallMyDeliveries",
    template: "<div />",
    methods: { refresh: deliveriesRefresh },
  },
};

const MINE = {
  on_call_now: true,
  teams: [{ team_id: "team_1", team_name: "Payments", on_call_now: true, on_call: [] }],
};

const render = () => mount(OnCallMine, { global: { plugins: [i18n, store], stubs } });

describe("OnCallMine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.myOnCall.mockResolvedValue({ data: MINE } as any);
  });

  it("serves a revisit from cache", async () => {
    const first = render();
    await flushPromises();
    expect(service.myOnCall).toHaveBeenCalledTimes(1);
    first.unmount();

    const wrapper = render();
    await flushPromises();

    expect(service.myOnCall).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="oncall-mine-team-team_1"]').text()).toContain("Payments");
  });

  it("forces both of its reads on Refresh", async () => {
    const wrapper = render();
    await flushPromises();
    expect(service.myOnCall).toHaveBeenCalledTimes(1);

    await wrapper.find('[data-test="oncall-mine-refresh"]').trigger("click");
    await flushPromises();

    expect(service.myOnCall).toHaveBeenCalledTimes(2);
    expect(deliveriesRefresh).toHaveBeenCalledTimes(1);
  });

  /// A refresh that fails must not tell an on-call engineer they are off duty.
  it("keeps the teams on screen when a refresh fails", async () => {
    const wrapper = render();
    await flushPromises();
    service.myOnCall.mockRejectedValueOnce(new Error("boom"));

    await wrapper.find('[data-test="oncall-mine-refresh"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-mine-team-team_1"]').text()).toContain("Payments");
    expect(wrapper.find('[data-test="oncall-mine-no-teams"]').exists()).toBe(false);
  });

  /// The entry fetch is the capability probe, so the cache layer has to hand the
  /// axios error through unwrapped — a 404 is on-call being off, not a failure.
  it("reads a 404 as the feature being off", async () => {
    service.myOnCall.mockRejectedValue({ response: { status: 404 } });

    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-mine-unavailable"]').exists()).toBe(true);
  });
});
