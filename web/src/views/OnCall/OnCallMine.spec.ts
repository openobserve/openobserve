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
    listMembers: vi.fn(),
    getSchedule: vi.fn(),
    createOverride: vi.fn(),
  },
}));
vi.mock("@/services/users", () => ({
  default: { orgUsers: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Read once at mount: a phone gets the stacked list, everything wider the table.
const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      isMobile: computed(() => viewport.mobile),
      isTablet: computed(() => false),
      isDesktop: computed(() => !viewport.mobile),
      mdUp: computed(() => !viewport.mobile),
      lgUp: computed(() => !viewport.mobile),
    }),
  };
});

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
  OTable: {
    name: "OTable",
    props: ["data", "columns"],
    template: `<div>
      <div v-for="(row, i) in (data || [])" :key="i">
        <slot v-for="c in (columns || [])" :key="c.id" :name="'cell-' + c.id" :row="row" />
      </div>
    </div>`,
  },
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
  OnCallCoverForm: {
    name: "OnCallCoverForm",
    props: ["open", "gap", "currentHolder", "defaultRotation", "teamName", "rotations", "members"],
    emits: ["save", "update:open"],
    template: "<div v-if='open' data-test='cover-form' />",
  },
  // Stubbed out: it reads its own endpoint, which this spec's service mock does
  // not carry, and its fetch would throw into its own catch for the wrong reason.
  OnCallMyDeliveries: {
    name: "OnCallMyDeliveries",
    props: ["teamNames", "canTest", "noTeam"],
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
    viewport.mobile = false;
    service.myOnCall.mockResolvedValue({ data: MINE } as any);
    service.listTeams.mockResolvedValue({ data: [] } as any);
    service.whoIsOnCall.mockRejectedValue({ response: { status: 403 } });
    service.resolvedSchedule.mockResolvedValue({ data: [] } as any);
  });

  /// Mounts the real page layout so the tag is proven to reach the rendered header.
  it("tags the page title as Beta", async () => {
    const wrapper = mount(OnCallMine, {
      global: { plugins: [i18n, store], stubs: { ...stubs, OPageLayout: false } },
    });
    await flushPromises();
    const badge = wrapper.find('[data-test="beta-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe(String(i18n.global.t("common.beta")));
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
    const until = wrapper.find('[data-test="oncall-mine-shift-team_1"]').text();
    expect(until).toMatch(/\d{2}:\d{2}/);
    expect(until).toMatch(/left$/);
    expect(until).not.toContain("—");
    expect(wrapper.find('[data-test="oncall-mine-next-team_1"]').text()).toBe("raj@o2.ai");
  });

  /// The next shift fits its cell as month, day and time; the year waits in the tooltip.
  it("names an off-duty row's next shift short, with the full date in its tooltip", async () => {
    const me = store.state.userInfo.email;
    const from = Date.now() * 1000 + 3 * 24 * 3_600_000_000;
    service.whoIsOnCall.mockResolvedValue({ data: [] } as any);
    service.myOnCall.mockResolvedValue({
      data: {
        on_call_now: false,
        teams: [{ team_id: "team_1", team_name: "Payments", on_call_now: false, on_call: [] }],
      },
    } as any);
    service.resolvedSchedule.mockResolvedValue({
      data: [{ rotation_id: "r1", from, to: from + 3_600_000_000, user_email: me }],
    } as any);
    const wrapper = render();
    await flushPromises();

    const until = wrapper.find('[data-test="oncall-mine-shift-team_1"]');
    expect(until.text()).toMatch(/^Next: [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/);
    const tip = until.findComponent({ name: "OTooltip" }).props("content");
    expect(tip).toMatch(/\d{4}, \d{2}:\d{2}$/);
  });

  /// The frame is five rows tall whatever lands in it, so the card never jumps between loading and loaded.
  it("keeps the shifts frame at five rows while loading and with one row", async () => {
    let answerMine: (value: unknown) => void = () => {};
    service.myOnCall.mockImplementationOnce(
      () => new Promise((resolve) => (answerMine = resolve)) as any,
    );
    const wrapper = render();
    await flushPromises();
    const frame = () => wrapper.find('[data-test="oncall-mine-shifts-frame"]');
    expect(frame().classes()).toContain("h-55.5");
    expect(wrapper.findComponent({ name: "OTable" }).attributes("skeleton-rows")).toBe("5");

    answerMine({ data: MINE });
    await flushPromises();
    expect(frame().classes()).toContain("h-55.5");
  });

  /// The cover form opens on the reader's own seat, from now until their shift ends.
  it("opens the cover form on the reader's own shift", async () => {
    const me = store.state.userInfo.email;
    const now = Date.now() * 1000;
    const end = now + 3_600_000_000;
    service.whoIsOnCall.mockResolvedValue({
      data: [{ rotation_id: "r1", rotation_name: "Primary", rule: "", user_email: me }],
    } as any);
    service.resolvedSchedule.mockResolvedValue({
      data: [{ rotation_id: "r1", from: now - 1_000_000, to: end, user_email: me }],
    } as any);
    service.listMembers.mockResolvedValue({ data: [] } as any);
    service.getSchedule.mockResolvedValue({ data: { rotations: [{ id: "r1" }] } } as any);
    const wrapper = render();
    await flushPromises();

    await wrapper.find('[data-test="oncall-mine-cover-team_1"]').trigger("click");
    await flushPromises();

    const form = wrapper.findComponent({ name: "OnCallCoverForm" });
    expect(form.props("open")).toBe(true);
    expect(form.props("gap").to).toBe(end);
    expect(form.props("currentHolder")).toBe(me);
    expect(form.props("defaultRotation")).toBe("r1");
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

    await wrapper.find('[data-test="oncall-mine-test-page-team_1"]').trigger("click");
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

  /// The header keeps its shape while loading, so nothing jumps when the read answers.
  it("draws the header actions before the first read answers", async () => {
    let answer: (value: unknown) => void = () => {};
    service.myOnCall.mockReturnValueOnce(
      new Promise((resolve) => (answer = resolve)) as ReturnType<typeof service.myOnCall>,
    );
    const wrapper = render();
    await flushPromises();
    const away = wrapper.find('[data-test="oncall-mine-away"]');
    expect(away.exists()).toBe(true);
    expect(away.attributes("disabled")).toBeDefined();

    answer({ data: MINE });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-mine-away"]').attributes("disabled")).toBeUndefined();
  });

  /// A top-level page has no back button.
  it("has no back button", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.findComponent({ name: "OPageLayout" }).props("back")).toBeUndefined();
  });

  /// A reader on a hundred teams gets every row, soonest first, scrolling inside a frame five rows tall.
  it("renders every shift inside a fixed five-row scrolling frame", async () => {
    const now = Date.now() * 1000;
    const teams = Array.from({ length: 120 }, (_, i) => ({
      team_id: `team_${i}`,
      team_name: `Team ${String(i).padStart(3, "0")}`,
      on_call_now: false,
      on_call: [],
    }));
    type Response<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;
    service.myOnCall.mockResolvedValue({
      data: { on_call_now: false, teams },
    } as unknown as Response<typeof service.myOnCall>);
    service.whoIsOnCall.mockResolvedValue({ data: [] } as unknown as Response<
      typeof service.whoIsOnCall
    >);
    const me = store.state.userInfo.email;
    // Later teams start sooner, so the sort and not the server's order decides the first five.
    service.resolvedSchedule.mockImplementation((args: { team_id: string }) => {
      const from = now + (200 - Number(args.team_id.split("_")[1])) * 3_600_000_000;
      return Promise.resolve({
        data: [{ rotation_id: "r1", from, to: from + 3_600_000_000, user_email: me }],
      } as unknown as Response<typeof service.resolvedSchedule>);
    });
    const wrapper = mount(OnCallMine, {
      global: { plugins: [i18n, store], stubs: { ...stubs, OTable: false } },
    });
    await flushPromises();

    const frame = () => wrapper.find('[data-test="oncall-mine-shifts-frame"]');
    expect(frame().classes()).toContain("h-55.5");
    const shown = () =>
      wrapper.findAll('[data-test^="oncall-mine-team-"]').map((link) => link.text());
    await vi.waitFor(() => expect(shown()).toHaveLength(120));
    expect(shown().slice(0, 5)).toEqual([
      "Team 119",
      "Team 118",
      "Team 117",
      "Team 116",
      "Team 115",
    ]);
    const scroller = wrapper.find('[data-test="o2-table-scroll-container"]');
    expect(scroller.classes()).toContain("overflow-y-auto");
    expect(frame().find('[data-test="o2-table-scroll-container"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-mine-shifts-toggle"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Show all");

    // The fold is marked below the frame, never over a row; once reached its line empties but keeps its height.
    const more = () => wrapper.find('[data-test="oncall-mine-shifts-more"]');
    expect(more().text()).toBe("115 more");
    expect(frame().find('[data-test="oncall-mine-shifts-more"]').exists()).toBe(false);
    await scroller.trigger("scroll");
    expect(more().exists()).toBe(true);
    expect(more().text()).toBe("");
    // Off duty holds no seat, so no team here needs the who-is-on-call read.
    expect(service.whoIsOnCall).not.toHaveBeenCalled();
  });

  /// "Am I on call" outranks "when is my next shift", so a held seat sorts above an off-duty row that starts sooner.
  it("sorts held seats first, then off-duty rows by their next shift", async () => {
    const me = store.state.userInfo.email;
    const now = Date.now() * 1000;
    service.myOnCall.mockResolvedValue({
      data: {
        on_call_now: true,
        teams: [
          { team_id: "off_soon", team_name: "Off soon", on_call_now: false, on_call: [] },
          { team_id: "held", team_name: "Held", on_call_now: true, on_call: [] },
        ],
      },
    } as any);
    service.whoIsOnCall.mockResolvedValue({
      data: [{ rotation_id: "r1", rotation_name: "Primary", rule: "", user_email: me }],
    } as any);
    service.resolvedSchedule.mockImplementation(
      (args: { team_id: string }) =>
        Promise.resolve({
          data:
            args.team_id === "held"
              ? [{ rotation_id: "r1", from: now - 1, to: now + 9 * 3_600_000_000, user_email: me }]
              : [
                  {
                    rotation_id: "r2",
                    from: now + 60_000_000,
                    to: now + 120_000_000,
                    user_email: me,
                  },
                ],
        }) as any,
    );
    const wrapper = mount(OnCallMine, {
      global: { plugins: [i18n, store], stubs: { ...stubs, OTable: false } },
    });
    await flushPromises();
    const names = () =>
      wrapper.findAll('[data-test^="oncall-mine-team-"]').map((link) => link.text());
    await vi.waitFor(() => expect(names()).toEqual(["Held", "Off soon"]));
  });

  /// Away only takes someone off a rotation, so a reader on no team has nothing to mark.
  it("hides I'm away and points the history at a team for a reader on no team", async () => {
    service.myOnCall.mockResolvedValue({ data: { on_call_now: false, teams: [] } } as any);
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-mine-away"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: "OnCallMyDeliveries" }).props("noTeam")).toBe(true);
  });

  it("marks no fold when every shift fits the frame", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-mine-shifts-more"]').exists()).toBe(false);
  });

  /// Five columns cannot fit a phone, so each shift is its own row with every action in one menu.
  it("stacks each shift as its own row on a phone", async () => {
    viewport.mobile = true;
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
    const menu = { template: "<div><slot name='trigger' /><slot /></div>" };
    const wrapper = mount(OnCallMine, {
      global: {
        plugins: [i18n, store],
        stubs: { ...stubs, ODropdown: menu, ODropdownItem: { template: "<div><slot /></div>" } },
      },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-mine-shifts-frame"]').exists()).toBe(false);
    const row = wrapper.find('[data-test="oncall-mine-shift-row-team_1"]');
    expect(row.find('[data-test="oncall-mine-team-team_1"]').text()).toBe("Payments");
    expect(row.find('[data-test="oncall-mine-duty-team_1"]').text()).toBe("Primary");
    expect(row.find('[data-test="oncall-mine-shift-team_1"]').text()).toMatch(/left$/);
    expect(row.find('[data-test="oncall-mine-next-team_1"]').text()).toBe("raj@o2.ai");
    expect(row.find('[data-test="oncall-mine-row-menu-team_1"]').exists()).toBe(true);
    expect(row.find('[data-test="oncall-mine-cover-team_1-menu"]').exists()).toBe(true);
    expect(row.find('[data-test="oncall-mine-test-page-team_1-menu"]').exists()).toBe(true);
  });
});
