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

import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import OnCallMine from "@/views/OnCall/OnCallMine.vue";

vi.mock("@/services/oncall", () => ({
  default: {
    myOnCall: vi.fn(),
    listTeams: vi.fn(),
    whoIsOnCall: vi.fn(),
    resolvedSchedule: vi.fn(),
    createUnavailability: vi.fn(),
    testPage: vi.fn(),
  },
}));
vi.mock("@/services/users", () => ({
  default: { orgUsers: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const service = vi.mocked(oncallService);

// The page's Refresh calls this through a template ref; the stub has to expose it or that call throws.
const deliveriesRefresh = vi.fn().mockResolvedValue(undefined);
const slackRefresh = vi.fn().mockResolvedValue(undefined);

const stubs = {
  OPageLayout: {
    name: "OPageLayout",
    props: ["back"],
    template: "<div><slot name='actions' /><slot /></div>",
  },
  OContent: { name: "OContent", template: "<div><slot /></div>" },
  OEmptyState: { name: "OEmptyState", template: "<div />" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OButton: {
    name: "OButton",
    props: ["disabled", "loading"],
    emits: ["click"],
    template: "<button :disabled='disabled' @click=\"$emit('click', $event)\"><slot /></button>",
  },
  OTooltip: { name: "OTooltip", props: ["content"], template: "<span />" },
  ODialog: {
    name: "ODialog",
    props: ["open"],
    template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  },
  ODate: {
    name: "ODate",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template:
      "<input :value='modelValue' @input=\"$emit('update:modelValue', $event.target.value)\" />",
  },
  OTime: {
    name: "OTime",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template:
      "<input :value='modelValue' @input=\"$emit('update:modelValue', $event.target.value)\" />",
  },
  ConfirmDialog: {
    name: "ConfirmDialog",
    props: ["modelValue", "message"],
    emits: ["update:ok", "update:cancel"],
    template: "<div v-if='modelValue' data-test='confirm'>{{ message }}</div>",
  },
  OText: { name: "OText", template: "<span><slot /></span>" },
  // Stubbed out: it reads its own endpoint, which this spec's service mock does
  // not carry, and its fetch would throw into its own catch for the wrong reason.
  OnCallMyDeliveries: {
    name: "OnCallMyDeliveries",
    props: ["teamNames", "canTest"],
    template: "<div />",
    methods: { refresh: deliveriesRefresh },
  },
  OnCallPhoneCard: {
    name: "OnCallPhoneCard",
    template: "<div data-test='oncall-phone-card' />",
    methods: { refresh: vi.fn().mockResolvedValue(undefined) },
  },
  // Stubbed out: it reads its own Slack endpoint; its own spec covers what it shows.
  OnCallSlackCard: {
    name: "OnCallSlackCard",
    template: "<div data-test='oncall-slack-card' />",
    methods: { refresh: slackRefresh },
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
    queryClient.clear();
    service.myOnCall.mockResolvedValue({ data: MINE } as any);
    service.listTeams.mockResolvedValue({ data: [] } as any);
    service.whoIsOnCall.mockRejectedValue({ response: { status: 403 } });
    service.resolvedSchedule.mockResolvedValue({ data: [] } as any);
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

  /// "Am I on call, and until when" is the question the page opens on, so the shift leads.
  it("shows the shift before how pages reach you", async () => {
    const wrapper = render();
    await flushPromises();

    const html = wrapper.html();
    expect(html.indexOf('data-test="oncall-mine-teams"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-test="oncall-mine-teams"')).toBeLessThan(
      html.indexOf('data-test="oncall-phone-card"'),
    );
  });

  it("names the seat, when the shift ends and who is next", async () => {
    const me = store.state.userInfo.email;
    const now = Date.now() * 1000;
    service.whoIsOnCall.mockResolvedValue({
      data: [{ rotation_id: "r1", rotation_name: "Primary", rule: "", user_email: me }],
    } as any);
    service.resolvedSchedule.mockResolvedValue({
      data: [
        { rotation_id: "r1", from: now - 1_000_000, to: now + 3_600_000_000, user_email: me },
        {
          rotation_id: "r1",
          from: now + 3_600_000_000,
          to: now + 7_200_000_000,
          user_email: "raj@o2.ai",
        },
      ],
    } as any);
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-mine-duty-team_1"]').text()).toBe("Primary");
    const line = wrapper.find('[data-test="oncall-mine-shift-team_1"]').text();
    expect(line).toContain("until");
    expect(line).toContain("then raj@o2.ai");
  });

  /// A role that may not read the schedule sees the duty tag alone, never a wrong shift end.
  it("hides the shift end when the schedule cannot be read", async () => {
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-mine-duty-team_1"]').text()).toBe("On call");
    expect(wrapper.find('[data-test="oncall-mine-shift-team_1"]').exists()).toBe(false);
  });

  /// Names a team the reader is not on, from the org team list, instead of its id.
  it("hands the deliveries every team's name", async () => {
    service.listTeams.mockResolvedValue({ data: [{ id: "team_9", name: "Search" }] } as any);
    const wrapper = render();
    await flushPromises();

    expect(wrapper.findComponent({ name: "OnCallMyDeliveries" }).props("teamNames")).toEqual({
      team_9: "Search",
      team_1: "Payments",
    });
  });

  /// Self-away needs no admin role: the server reads a missing user_email as the caller.
  it("marks the reader away without naming them", async () => {
    service.createUnavailability.mockResolvedValue({ data: {} } as any);
    const wrapper = render();
    await flushPromises();

    await wrapper.find('[data-test="oncall-mine-away"]').trigger("click");
    await wrapper.find('[data-test="oncall-mine-away-from-date"]').setValue("2030-01-01");
    await wrapper.find('[data-test="oncall-mine-away-from-time"]').setValue("09:00");
    await wrapper.find('[data-test="oncall-mine-away-to-date"]').setValue("2030-01-02");
    await wrapper.find('[data-test="oncall-mine-away-to-time"]').setValue("09:00");
    await wrapper.find('[data-test="oncall-mine-away-save"]').trigger("click");
    await flushPromises();

    const data = service.createUnavailability.mock.calls[0][0].data;
    expect(data.user_email).toBeUndefined();
    expect(data.end_at).toBeGreaterThan(data.start_at);
  });

  it("sends the team test page after a confirm", async () => {
    service.testPage.mockResolvedValue({
      data: {
        reached_anyone: true,
        channels: ["email"],
        attempts: [{ channel: "email", recipient: "a@o2.ai", reason: "", delivered: true }],
      },
    } as any);
    const wrapper = render();
    await flushPromises();

    await wrapper.find('[data-test="oncall-mine-test-page"]').trigger("click");
    expect(service.testPage).not.toHaveBeenCalled();
    wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();

    expect(service.testPage).toHaveBeenCalledWith(expect.objectContaining({ team_id: "team_1" }));
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

  /// A failed first load is not "you are on no team" — that would tell an on-call engineer they are off duty.
  it("shows the error with a retry when the first load fails", async () => {
    queryClient.clear();
    service.myOnCall.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-mine-no-teams"]').exists()).toBe(false);
    const error = wrapper.findComponent('[data-test="oncall-mine-teams-error"]');
    expect(error.exists()).toBe(true);

    error.vm.$emit("action");
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-mine-teams-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-mine-team-team_1"]').exists()).toBe(true);
  });

  /// Shown only while Slack is on; members hear nothing about Slack otherwise.
  it.each([
    [{ slack_enabled: true }, true],
    [{ slack_enabled: false, slack_disabled_reason: "flag" }, false],
    [{}, false],
  ])("Slack box for zoConfig %j shown: %s", async (slackConfig, shown) => {
    const saved = store.state.zoConfig;
    store.state.zoConfig = { ...saved, slack_enabled: undefined, ...slackConfig };
    try {
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-slack-card"]').exists()).toBe(shown);
    } finally {
      store.state.zoConfig = saved;
    }
  });

  /// A link just made with /o2 link shows after Refresh.
  it("reads the Slack link again on Refresh", async () => {
    const saved = store.state.zoConfig;
    store.state.zoConfig = { ...saved, slack_enabled: true };
    try {
      const wrapper = render();
      await flushPromises();
      await wrapper.find('[data-test="oncall-mine-refresh"]').trigger("click");
      await flushPromises();
      expect(slackRefresh).toHaveBeenCalledTimes(1);
    } finally {
      store.state.zoConfig = saved;
    }
  });

  /// A top-level page has no back button.
  it("has no back button", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.findComponent({ name: "OPageLayout" }).props("back")).toBeUndefined();
  });
});
