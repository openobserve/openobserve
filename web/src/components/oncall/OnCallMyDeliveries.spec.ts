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

import OnCallMyDeliveries from "@/components/oncall/OnCallMyDeliveries.vue";
import LicenseDeniedState from "@/components/common/LicenseDeniedState.vue";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import { resetListViewState, useListViewState } from "@/composables/useListViewState";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import type { MyDelivery } from "@/ts/interfaces/oncall";
import { axiosReply } from "@/test/unit/helpers/mockService";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";

vi.mock("@/services/oncall", () => ({
  default: { myDeliveries: vi.fn(), markDeliveriesRead: vi.fn(), acknowledgeResponse: vi.fn() },
}));

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const service = vi.mocked(oncallService);

const stubs = {
  OTable: {
    name: "OTable",
    props: ["data", "columns", "currentPage", "pageSize"],
    emits: ["row-click", "update:currentPage", "update:pageSize"],
    template: `<div>
      <div v-for="(row, i) in (data || [])" :key="i" data-test="row" @click="$emit('row-click', row)">
        <slot v-for="c in (columns || [])" :key="c.id" :name="'cell-' + c.id" :row="row" />
      </div>
    </div>`,
  },
  OEmptyState: {
    name: "OEmptyState",
    props: ["title", "description", "actionLabel"],
    emits: ["action"],
    template:
      "<div>{{ title }} {{ description }}<button v-if='actionLabel' data-test='empty-action' @click=\"$emit('action')\">{{ actionLabel }}</button></div>",
  },
  OTooltip: { name: "OTooltip", props: ["content"], template: "<span />" },
  // `type` and `value` are declared so the state chip can be asserted on: an
  // undeclared prop lands in attrs and `props("value")` reads undefined.
  OTag: { name: "OTag", props: ["variant", "type", "value"], template: "<span><slot /></span>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTimeCell: { name: "OTimeCell", props: ["value", "unit"], template: "<span />" },
  OButton: {
    name: "OButton",
    props: ["iconLeft", "loading"],
    emits: ["click"],
    template: `<button @click="$emit('click', $event)"><slot /></button>`,
  },
  OCheckbox: {
    name: "OCheckbox",
    props: ["modelValue", "label"],
    emits: ["update:modelValue"],
    // No data-test of its own: the component passes one, and an inherited attr
    // wins over a static one, so a stub that sets its own is untargetable.
    template: `<button @click="$emit('update:modelValue', !modelValue)">{{ label }}</button>`,
  },
};

const AT = 1_786_000_050_000_000;

function delivery(over: Partial<MyDelivery> = {}): MyDelivery {
  return {
    event_id: "ev_88",
    response_id: "resp_1",
    at: AT,
    body: "email to ana@o2.ai",
    channel: "email",
    delivered: true,
    ladder_run: 1,
    rung_micros: 0,
    team_id: "team_platform",
    title: "payment_gateway_error_rate above 5%",
    priority: 2,
    response_state: "acknowledged",
    subject_type: "alert",
    subject_id: "al_checkout_5xx#2",
    read: true,
    ...over,
  };
}

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallMyDeliveries, {
    props,
    global: { plugins: [i18n, store], stubs },
  });
}

const history = (wrapper: ReturnType<typeof render>) =>
  wrapper.findComponent('[data-test="oncall-my-deliveries-table"]');
const historyRows = (wrapper: ReturnType<typeof render>) =>
  history(wrapper).findAll('[data-test="row"]');
/// The server counts unread sends, not pages, and ignores both the filter and the row window.
const answer = (deliveries: MyDelivery[], unread = deliveries.filter((d) => !d.read).length) =>
  service.myDeliveries.mockResolvedValue(
    axiosReply({ total: deliveries.length, unread, deliveries }),
  );

describe("OnCallMyDeliveries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    resetListViewState();
    window.localStorage.clear();
    answer([]);
    service.markDeliveriesRead.mockResolvedValue(axiosReply({ updated: 1, unread: 0 }));
    service.acknowledgeResponse.mockResolvedValue(axiosReply({}));
  });

  /// Only channels that were tried are drawn, each saying whether it landed.
  it("says per channel whether the latest page reached the reader", async () => {
    answer([
      delivery({ event_id: "ev_ok", channel: "email", delivered: true }),
      delivery({ event_id: "ev_bad", channel: "sms", delivered: false }),
    ]);
    const wrapper = render();
    await flushPromises();

    const row = historyRows(wrapper)[0];
    const email = row.find('[data-test$="-email"]');
    const sms = row.find('[data-test$="-sms"]');
    expect(email.findComponent({ name: "OTooltip" }).props("content")).toContain("Sent to you");
    expect(sms.findComponent({ name: "OTooltip" }).props("content")).toContain("did not reach you");
    expect(row.find('[data-test$="-voice"]').exists()).toBe(false);
  });

  /// One alert that paged ten times is one row with a count, not ten identical rows.
  it("groups the history by alert", async () => {
    answer([
      delivery({ event_id: "ev_1", response_id: "resp_1", at: AT }),
      delivery({ event_id: "ev_2", response_id: "resp_2", at: AT + 1 }),
      delivery({
        event_id: "ev_3",
        response_id: "resp_3",
        subject_id: "al_other",
        title: "disk full",
        at: AT + 2,
      }),
    ]);
    const wrapper = render();
    await flushPromises();

    expect(historyRows(wrapper)).toHaveLength(2);
    expect(historyRows(wrapper)[1].text()).toContain("×2");
  });

  /// An alert and the incident it opened page under one name; two rows the reader cannot tell apart are one.
  it("groups pages that share a name across subjects and teams", async () => {
    answer([
      delivery({ event_id: "ev_1", response_id: "resp_1", team_id: "team_dev", at: AT }),
      delivery({
        event_id: "ev_2",
        response_id: "resp_2",
        subject_type: "incident",
        subject_id: "inc_1#1",
        team_id: "team_dev",
        at: AT + 1,
      }),
      delivery({
        event_id: "ev_3",
        response_id: "resp_3",
        subject_type: "incident",
        subject_id: "inc_2#1",
        team_id: "team_sre",
        at: AT + 2,
      }),
    ]);
    const wrapper = render({ teamNames: { team_dev: "Dev Team", team_sre: "Platform SRE" } });
    await flushPromises();

    expect(historyRows(wrapper)).toHaveLength(1);
    expect(historyRows(wrapper)[0].text()).toContain("×3");
    expect(historyRows(wrapper)[0].text()).toContain("Platform SRE, Dev Team");
  });

  /// The subject id ends in the firing number, so two firings of one alert are still one row.
  it("groups an alert's firings into one row", async () => {
    answer([
      delivery({ event_id: "ev_1", response_id: "resp_1", subject_id: "al_ckt#1", at: AT }),
      delivery({ event_id: "ev_2", response_id: "resp_2", subject_id: "al_ckt#2", at: AT + 1 }),
    ]);
    const wrapper = render();
    await flushPromises();

    expect(historyRows(wrapper)).toHaveLength(1);
    expect(historyRows(wrapper)[0].text()).toContain("×2");
  });

  /// `response_state` is the state now, so a row for something resolved says so.
  it("renders the record's current state, not its state when paged", async () => {
    answer([delivery({ response_state: "resolved" })]);
    const wrapper = render();
    await flushPromises();

    const tags = history(wrapper).findAllComponents({ name: "OTag" });
    expect(tags.some((tag) => tag.props("value") === "resolved")).toBe(true);
  });

  it("names the team rather than its id when it can", async () => {
    answer([delivery()]);
    const wrapper = render({ teamNames: { team_platform: "Platform" } });
    await flushPromises();

    expect(wrapper.text()).toContain("Platform");
    expect(wrapper.text()).not.toContain("team_platform");
  });

  it("never shows a raw team id: a skeleton while teams load, then the deleted-team label", async () => {
    answer([delivery()]);
    const wrapper = render({ teamsState: "pending" });
    await flushPromises();
    expect(wrapper.text()).not.toContain("team_platform");
    expect(wrapper.findComponent({ name: "OSkeleton" }).exists()).toBe(true);

    await wrapper.setProps({ teamsState: "loaded" });
    expect(wrapper.text()).not.toContain("team_platform");
    expect(wrapper.text()).toContain("Deleted team");
  });

  describe("needs you now", () => {
    it("lists each open page once, with Acknowledge while it is still paging", async () => {
      answer([
        delivery({ event_id: "ev_1", response_id: "resp_1", response_state: "triggered" }),
        delivery({
          event_id: "ev_2",
          response_id: "resp_1",
          response_state: "triggered",
          channel: "sms",
        }),
        delivery({ event_id: "ev_3", response_id: "resp_2", subject_id: "al_b" }),
        delivery({ event_id: "ev_4", response_id: "resp_3", response_state: "resolved" }),
      ]);
      const wrapper = render();
      await flushPromises();

      const open = wrapper.findComponent('[data-test="oncall-my-needs-you-table"]');
      expect(open.findAll('[data-test="row"]')).toHaveLength(2);
      expect(wrapper.find('[data-test="oncall-my-needs-you-ack-resp_1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-my-needs-you-ack-resp_2"]').exists()).toBe(false);
    });

    it("acknowledges from the row and reads the inbox again", async () => {
      answer([delivery({ response_state: "triggered" })]);
      const wrapper = render();
      await flushPromises();
      const reads = service.myDeliveries.mock.calls.length;

      await wrapper.find('[data-test="oncall-my-needs-you-ack-resp_1"]').trigger("click");
      await flushPromises();

      expect(service.acknowledgeResponse).toHaveBeenCalledWith(
        expect.objectContaining({ response_id: "resp_1" }),
      );
      expect(service.myDeliveries.mock.calls.length).toBe(reads + 1);
    });

    it("is absent when nothing is open", async () => {
      answer([delivery({ response_state: "resolved" })]);
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-my-needs-you"]').exists()).toBe(false);
    });

    const NEEDS_YOU_KEY = "oncall-my-needs-you:default:example@gmail.com";

    /// The card holds its place through the first read when the last visit had open pages.
    it("reserves its card while loading when the last visit had open pages", async () => {
      window.localStorage.setItem(NEEDS_YOU_KEY, "flat");
      service.myDeliveries.mockReturnValue(new Promise(() => {}));
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-my-needs-you"]').exists()).toBe(true);
      expect(
        wrapper.findAll('[data-test="oncall-my-needs-you-table"] [data-test="row"]'),
      ).toHaveLength(0);
    });

    it("drops the reservation once a load has nothing open", async () => {
      window.localStorage.setItem(NEEDS_YOU_KEY, "paged");
      answer([delivery({ response_state: "resolved" })]);
      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-my-needs-you"]').exists()).toBe(false);
      expect(window.localStorage.getItem(NEEDS_YOU_KEY)).toBe(null);
    });

    it("remembers open pages for the next visit's skeleton", async () => {
      answer([delivery({ response_state: "triggered" })]);
      render();
      await flushPromises();
      expect(window.localStorage.getItem(NEEDS_YOU_KEY)).toBe("flat");
    });

    /// A pinned column draws a divider; a table with nothing to scroll past keeps its actions unpinned.
    it("does not pin the actions column", async () => {
      answer([delivery({ response_state: "triggered" })]);
      const { OTable: _table, ...realTable } = stubs;
      const wrapper = mount(OnCallMyDeliveries, {
        global: { plugins: [i18n, store], stubs: realTable },
      });
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 60));
      await flushPromises();

      const card = wrapper.find('[data-test="oncall-my-needs-you"]');
      expect(card.find('[data-test="oncall-my-needs-you-ack-resp_1"]').exists()).toBe(true);
      const sticky = card
        .findAll("td, th")
        .filter((cell) => (cell.attributes("style") ?? "").includes("sticky"));
      expect(sticky).toHaveLength(0);
    });
  });

  describe("the unread badge", () => {
    /// The server's read state decides, resolved or not; one page on two channels is one unread.
    it("counts unread pages, resolved included, and reports the count outward", async () => {
      answer([
        delivery({ event_id: "ev_1", response_id: "resp_1", read: false }),
        delivery({ event_id: "ev_2", response_id: "resp_1", read: false, channel: "sms" }),
        delivery({
          event_id: "ev_3",
          response_id: "resp_2",
          subject_id: "other-alert",
          read: false,
          response_state: "resolved",
        }),
      ]);
      const wrapper = render();
      await flushPromises();

      expect(wrapper.emitted("unread")?.at(-1)).toEqual([2]);
      expect(wrapper.find('[data-test="oncall-my-deliveries-unread"]').text()).toContain("2");
    });

    it("takes the server's total when older unread pages lie past the loaded 100", async () => {
      const loaded = Array.from({ length: 100 }, (_, i) =>
        delivery({
          event_id: `ev_${i}`,
          response_id: `resp_${i}`,
          subject_id: `al_${i}`,
          read: i >= 60,
        }),
      );
      answer(loaded, 140);
      const wrapper = render();
      await flushPromises();

      expect(wrapper.emitted("unread")?.at(-1)).toEqual([140]);
      expect(wrapper.find('[data-test="oncall-my-deliveries-unread"]').text()).toContain("140");
      expect(wrapper.find('[data-test="oncall-my-deliveries-read-all"]').classes()).not.toContain(
        "invisible",
      );
    });

    it("keeps the badge when Unread only is ticked", async () => {
      const send = (i: number, read: boolean) =>
        delivery({
          event_id: `ev_${i}`,
          response_id: `resp_${i % 50}`,
          subject_id: `al_${i}`,
          read,
        });
      service.myDeliveries.mockImplementation(async (args) =>
        axiosReply({
          total: 100,
          unread: 150,
          deliveries: Array.from({ length: 100 }, (_, i) =>
            send(i, args.unread_only ? false : i >= 40),
          ),
        }),
      );
      const wrapper = render();
      await flushPromises();
      const before = wrapper.emitted("unread")?.at(-1);

      await wrapper.find('[data-test="oncall-my-deliveries-unread-toggle"]').trigger("click");
      await flushPromises();

      expect(wrapper.emitted("unread")?.at(-1)).toEqual(before);
    });

    it("shows Mark all read when every loaded row is read but older ones are not", async () => {
      answer([delivery({ read: true })], 3);
      const wrapper = render();
      await flushPromises();

      expect(wrapper.emitted("unread")?.at(-1)).toEqual([3]);
      expect(wrapper.find('[data-test="oncall-my-deliveries-read-all"]').classes()).not.toContain(
        "invisible",
      );
    });

    it("shows the unread dot on an unread resolved alert", async () => {
      answer([delivery({ read: false, response_state: "resolved" })]);
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-my-delivery-unread-ev_88"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-my-deliveries-unread-toggle"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-my-deliveries-read-all"]').exists()).toBe(true);
    });
  });

  it("asks for unread only when the filter is on", async () => {
    answer([delivery({ read: false })]);
    const wrapper = render();
    await flushPromises();

    await wrapper.find('[data-test="oncall-my-deliveries-unread-toggle"]').trigger("click");
    await flushPromises();

    expect(service.myDeliveries.mock.calls.at(-1)![0]).toMatchObject({ unread_only: true });
  });

  it("keeps a read open page in Needs you while History shows unread only", async () => {
    const open = delivery({
      event_id: "ev_open",
      response_id: "resp_open",
      read: true,
      response_state: "triggered",
    });
    const unreadOne = delivery({
      event_id: "ev_new",
      response_id: "resp_new",
      subject_id: "al_new",
      title: "disk full",
      read: false,
      response_state: "resolved",
    });
    service.myDeliveries.mockImplementation(async (args) =>
      axiosReply({
        total: args.unread_only ? 1 : 2,
        unread: 1,
        deliveries: args.unread_only ? [unreadOne] : [open, unreadOne],
      }),
    );
    const wrapper = render();
    await flushPromises();
    const needsYou = () => wrapper.findComponent('[data-test="oncall-my-needs-you-table"]');
    expect(needsYou().props("data")).toHaveLength(1);

    await wrapper.find('[data-test="oncall-my-deliveries-unread-toggle"]').trigger("click");
    await flushPromises();

    expect(historyRows(wrapper)).toHaveLength(1);
    expect(needsYou().props("data")).toEqual([open]);
    expect(wrapper.find('[data-test="oncall-my-needs-you-ack-resp_open"]').exists()).toBe(true);
  });

  it("reads the unfiltered inbox for Needs you when the page opens on unread only", async () => {
    Object.assign(useListViewState("oncall-my-deliveries", {}), { unreadOnly: true });
    answer([delivery({ read: true, response_state: "triggered" })]);
    const wrapper = render();
    await flushPromises();

    const filters = service.myDeliveries.mock.calls.map(([args]) => !!args.unread_only);
    expect(filters.sort()).toEqual([false, true]);
    expect(wrapper.find('[data-test="oncall-my-needs-you"]').exists()).toBe(true);
  });

  /// A read, resolved page still offers "Mark unread" on its row, and nothing to filter.
  it("keeps the mark-unread button on a read resolved page", async () => {
    answer([delivery({ read: true, response_state: "resolved" })]);
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-my-deliveries-controls"]').classes()).toContain(
      "invisible",
    );
    const toggle = wrapper.findComponent('[data-test="oncall-my-delivery-toggle-ev_88"]');
    expect(toggle.props("iconLeft")).toBe("mark-email-unread");
    expect(toggle.findComponent({ name: "OTooltip" }).props("content")).toBe("Mark unread");
    await toggle.trigger("click");
    await flushPromises();
    expect(service.markDeliveriesRead).toHaveBeenCalledWith(
      expect.objectContaining({ data: { event_ids: ["ev_88"], read: false } }),
    );
  });

  /// An empty list has nothing to narrow, so the filter is hidden; it keeps its slot so the header never reflows.
  it("hides the unread filter on an empty list without removing its slot", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-my-deliveries-controls"]').classes()).toContain(
      "invisible",
    );
  });

  it("shows the filter and Mark all read once something is unread", async () => {
    answer([delivery({ read: false })]);
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-my-deliveries-controls"]').classes()).not.toContain(
      "invisible",
    );
    expect(wrapper.find('[data-test="oncall-my-deliveries-read-all"]').classes()).not.toContain(
      "invisible",
    );
  });

  /// A reader on no team has no page to test, so the empty history points them at a team instead.
  it("offers Join a team on an empty history when the reader is on no team", async () => {
    const wrapper = render({ noTeam: true });
    await flushPromises();
    const action = wrapper.find('[data-test="empty-action"]');
    expect(action.text()).toBe("Join a team");
    await action.trigger("click");
    expect(wrapper.emitted("join-team")).toHaveLength(1);
  });

  /// Unticking answers from the cache at once, so the slower "unread only" answer must not narrow a widened inbox.
  it("ignores a slower answer for a filter the reader has already left", async () => {
    answer([delivery({ read: false })]);
    const wrapper = render();
    await flushPromises();
    let answerUnread: (value: unknown) => void = () => {};
    service.myDeliveries.mockImplementationOnce(
      () => new Promise((resolve) => (answerUnread = resolve)),
    );
    const toggle = wrapper.find('[data-test="oncall-my-deliveries-unread-toggle"]');

    await toggle.trigger("click");
    await flushPromises();
    await toggle.trigger("click");
    await flushPromises();
    answerUnread({
      data: {
        total: 2,
        unread: 2,
        deliveries: [
          delivery({ read: false, subject_id: "al_x" }),
          delivery({ read: false, subject_id: "al_y" }),
        ],
      },
    });
    await flushPromises();

    expect(historyRows(wrapper)).toHaveLength(1);
  });

  /// A refresh that fails must not empty the inbox and zero the badge.
  it("keeps the inbox on screen when a refresh fails", async () => {
    answer([delivery({ read: false })]);
    const wrapper = render();
    await flushPromises();
    service.myDeliveries.mockRejectedValueOnce(new Error("boom"));

    await (wrapper.vm as any).refresh();
    await flushPromises();

    expect(historyRows(wrapper)).toHaveLength(1);
    expect(wrapper.emitted("unread")?.at(-1)).toEqual([1]);
  });

  describe("marking read", () => {
    it("clears the whole inbox in one call", async () => {
      answer([delivery({ read: false })]);
      const wrapper = render();
      await flushPromises();

      await wrapper.find('[data-test="oncall-my-deliveries-read-all"]').trigger("click");
      await flushPromises();

      expect(service.markDeliveriesRead).toHaveBeenCalledWith(
        expect.objectContaining({ data: { all: true, read: true } }),
      );
    });

    it("reads every send of an unread alert from its row button", async () => {
      answer([
        delivery({ event_id: "ev_1", read: false, at: AT + 1 }),
        delivery({ event_id: "ev_2", read: false, channel: "sms" }),
      ]);
      const wrapper = render();
      await flushPromises();

      const toggle = wrapper.findComponent('[data-test="oncall-my-delivery-toggle-ev_1"]');
      expect(toggle.props("iconLeft")).toBe("check-circle");
      expect(toggle.findComponent({ name: "OTooltip" }).props("content")).toBe("Mark read");
      await toggle.trigger("click");
      await flushPromises();

      expect(service.markDeliveriesRead).toHaveBeenCalledWith(
        expect.objectContaining({ data: { event_ids: ["ev_1", "ev_2"], read: true } }),
      );
    });

    /// Somebody who dismissed a page by accident at 3am has to be able to put it back.
    it("puts a read alert back to unread", async () => {
      answer([delivery({ read: true })]);
      const wrapper = render();
      await flushPromises();

      await wrapper.find('[data-test="oncall-my-delivery-toggle-ev_88"]').trigger("click");
      await flushPromises();

      expect(service.markDeliveriesRead).toHaveBeenCalledWith(
        expect.objectContaining({ data: { event_ids: ["ev_88"], read: false } }),
      );
    });
  });

  /// A revisit is served from cache, and the re-read after a write still reaches the server.
  it("serves a revisit from cache, and still re-reads after a write", async () => {
    answer([delivery({ read: false })]);

    const first = render();
    await flushPromises();
    expect(service.myDeliveries).toHaveBeenCalledTimes(1);
    first.unmount();

    const wrapper = render();
    await flushPromises();
    expect(service.myDeliveries).toHaveBeenCalledTimes(1);

    await wrapper.find('[data-test="oncall-my-delivery-toggle-ev_88"]').trigger("click");
    await flushPromises();

    expect(service.markDeliveriesRead).toHaveBeenCalledTimes(1);
    expect(service.myDeliveries).toHaveBeenCalledTimes(2);
  });

  it("opens the page a row was sent for", async () => {
    answer([delivery()]);
    const wrapper = render();
    await flushPromises();
    await historyRows(wrapper)[0].trigger("click");

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "onCallResponseDetail",
        params: { responseId: "resp_1" },
      }),
    );
  });

  /// A failed first load is not "nothing was sent".
  it("shows the error with a retry when the first load fails", async () => {
    service.myDeliveries.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-my-deliveries-empty"]').exists()).toBe(false);
    const error = wrapper.findComponent('[data-test="oncall-my-deliveries-error"]');
    expect(error.exists()).toBe(true);

    error.vm.$emit("action");
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-my-deliveries-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-my-deliveries-empty"]').exists()).toBe(true);
  });

  describe("a license denial", () => {
    const DENIAL = {
      response: {
        status: 403,
        data: {
          code: 40001,
          message: "Features not included in your license: oncall",
          error_detail: "oncall",
        },
      },
    };

    function expectLocked(wrapper: ReturnType<typeof render>) {
      const lock = wrapper.findComponent(LicenseDeniedState);
      expect(lock.props("features")).toEqual(["oncall"]);
      expect(lock.attributes("data-test")).toBe("oncall-my-deliveries-license-denied");
      expect(wrapper.find('[data-test="oncall-my-deliveries-error"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-my-deliveries-table"]').exists()).toBe(false);
      expect(wrapper.emitted("licenseDenied")).toEqual([[["oncall"]]]);
    }

    it("shows the lock and tells the page when the first load is denied", async () => {
      queryClient.clear();
      service.myDeliveries.mockRejectedValueOnce(DENIAL);
      const wrapper = render();
      await flushPromises();

      expectLocked(wrapper);
    });

    it("shows the lock instead of keeping the inbox when a refresh is denied", async () => {
      queryClient.clear();
      service.myDeliveries.mockResolvedValue({
        data: { total: 1, unread: 1, deliveries: [delivery({ read: false })] },
      } as any);
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-my-deliveries-unread"]').exists()).toBe(true);

      service.myDeliveries.mockRejectedValueOnce(DENIAL);
      await (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh();
      await flushPromises();

      expectLocked(wrapper);
      expect(wrapper.find('[data-test="oncall-my-deliveries-unread"]').exists()).toBe(false);
    });
  });

  /// A history row is placed against a deploy or a shift by its minute, so it shows the clock time.
  it("dates a row with its clock time, not a bare date", async () => {
    answer([delivery()]);
    const wrapper = render();
    await flushPromises();

    expect(history(wrapper).text()).toMatch(/\d{4}, \d{2}:\d{2}/);
  });

  it("dates an open page with its clock time, as History does", async () => {
    answer([delivery({ response_state: "triggered" })]);
    const wrapper = render();
    await flushPromises();

    const sent = wrapper.find('[data-test="oncall-my-deliveries-sent-at"]');
    expect(sent.text()).toMatch(/\d{4}, \d{2}:\d{2}/);
  });

  /// Nothing to page through, so no pager under a handful of rows.
  it("hides the pager while every row fits on one page", async () => {
    answer([delivery()]);
    const wrapper = render();
    await flushPromises();

    expect(history(wrapper).findComponent({ name: "OTable" }).attributes("pagination")).toBe(
      "none",
    );
  });

  /// The dot column is always there: arriving with the first unread row shifted every other column. Actions are not pinned.
  it("keeps the unread column when nothing is unread", async () => {
    answer([delivery({ read: true })]);
    const wrapper = render();
    await flushPromises();

    const columns = history(wrapper).findComponent({ name: "OTable" }).props("columns") as {
      id: string;
    }[];
    expect(columns.map((c) => c.id)).toEqual([
      "unread",
      "page",
      "team",
      "state",
      "channels",
      "at",
      "row-actions",
    ]);
    expect(columns.some((c) => "pinned" in c)).toBe(false);
  });

  it("names the team that the empty history's test page goes to", async () => {
    const wrapper = render({ canTest: true, testTeamName: "Payments" });
    await flushPromises();
    expect(wrapper.find('[data-test="empty-action"]').text()).toBe("Send a test page to Payments");
  });

  /// The empty history names the one next step: a test page, when the reader has a team to test.
  it("offers the team test page as the next step on an empty history", async () => {
    const wrapper = render({ canTest: true });
    await flushPromises();
    expect(wrapper.text()).toContain("Nothing has paged you yet");

    await wrapper.find('[data-test="empty-action"]').trigger("click");
    expect(wrapper.emitted("test-page")).toHaveLength(1);
  });

  it("offers no next step without a team to test", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="empty-action"]').exists()).toBe(false);
    // The title alone: the explainer under it restated what the reader already sees.
    expect(wrapper.text()).not.toContain("Pages show here once");
  });

  /// The first paint is a full page, so the fixed-height card looks the same before and after rows arrive.
  it("skeletons ten history rows while the first read is out", async () => {
    service.myDeliveries.mockReturnValue(new Promise<never>(() => {}));
    const wrapper = render();
    await flushPromises();
    expect(history(wrapper).findComponent({ name: "OTable" }).attributes("skeleton-rows")).toBe(
      "10",
    );
  });

  it("keeps the empty history at the table's fixed height", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-my-deliveries-empty-frame"]').classes()).toContain(
      "h-104",
    );
  });

  describe("needs you pager", () => {
    const open = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        delivery({ event_id: `ev_${i}`, response_id: `resp_${i}`, at: AT + i }),
      );
    const needsYou = (wrapper: ReturnType<typeof render>) =>
      wrapper.findComponent('[data-test="oncall-my-needs-you-table"]');

    it("hides the pager while every open page fits", async () => {
      answer(open(10));
      const wrapper = render();
      await flushPromises();

      expect(needsYou(wrapper).attributes("pagination")).toBe("none");
    });

    it("pages the open pages once they outgrow one page", async () => {
      answer(open(11));
      const wrapper = render();
      await flushPromises();

      expect(needsYou(wrapper).attributes("pagination")).toBe("client");
      expect(needsYou(wrapper).props("pageSize")).toBe(10);
    });

    it("keeps the chosen page size for the next visit", async () => {
      answer(open(11));
      const wrapper = render();
      await flushPromises();
      needsYou(wrapper).vm.$emit("update:pageSize", 50);
      await flushPromises();

      const saved = useListViewState("oncall-my-deliveries", {}) as Record<string, unknown>;
      expect(saved.openPageSize).toBe(50);
    });

    it("pages through the open pages in the real table", async () => {
      answer(open(25));
      const { OTable: _table, ...rest } = stubs;
      const wrapper = mount(OnCallMyDeliveries, {
        global: { plugins: [i18n, store], stubs: rest },
      });
      await flushPromises();

      const card = wrapper.find('[data-test="oncall-my-needs-you"]');
      expect(card.find('[data-test="o2-table-pagination-bottom"]').exists()).toBe(true);
      expect(card.find('[data-test="o2-table-pagination-info"]').text()).toMatch(/1\D+10\D+25/);
      await card.find('[data-test="o2-table-next-page-btn"]').trigger("click");
      await flushPromises();
      expect(card.find('[data-test="o2-table-pagination-info"]').text()).toMatch(/11\D+20\D+25/);
    });
  });

  describe("history pager in the real table", () => {
    const sent = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        delivery({
          event_id: `ev_${i}`,
          response_id: `resp_${i}`,
          title: `alert ${i}`,
          response_state: "resolved",
          at: AT + i,
        }),
      );
    const { OTable: _table, ...realTable } = stubs;
    const card = (wrapper: ReturnType<typeof render>) =>
      wrapper.find('[data-test="oncall-my-history"]');
    const rendered = (wrapper: ReturnType<typeof render>) =>
      card(wrapper).findAll('[data-test^="o2-table-row-"]:not([data-test$="drag-handle"])');

    const mountReal = async () => {
      const wrapper = mount(OnCallMyDeliveries, {
        global: { plugins: [i18n, store], stubs: realTable },
      });
      await flushPromises();
      // OTable holds its skeleton for a short minimum after loading ends.
      await new Promise((resolve) => setTimeout(resolve, 60));
      await flushPromises();
      return wrapper;
    };
    const table = (wrapper: ReturnType<typeof render>) =>
      card(wrapper).find('[data-test="oncall-my-deliveries-table"]');
    const pager = (wrapper: ReturnType<typeof render>) =>
      card(wrapper).find('[data-test="o2-table-pagination-bottom"]');

    /// The scroller, not the table, carries the height, so the pager sits under the ten-row body.
    it("keeps a fixed ten-row body with only two rows and no pager", async () => {
      answer(sent(2));
      const wrapper = await mountReal();

      expect(rendered(wrapper)).toHaveLength(2);
      expect(table(wrapper).classes()).toContain("[&_[data-test=o2-table-scroll-container]]:h-104");
      expect(table(wrapper).classes()).toContain("h-auto");
      expect(pager(wrapper).exists()).toBe(false);
    });

    /// One action is a button on the row, never a menu holding a single item.
    it("marks a row unread from its own button in the real table", async () => {
      answer(sent(2));
      const wrapper = await mountReal();

      await card(wrapper).find('[data-test="oncall-my-delivery-toggle-ev_0"]').trigger("click");
      await flushPromises();
      expect(service.markDeliveriesRead).toHaveBeenCalledWith(
        expect.objectContaining({ data: { event_ids: ["ev_0"], read: false } }),
      );
    });

    it("holds the same fixed body while loading", async () => {
      service.myDeliveries.mockReturnValue(new Promise<never>(() => {}));
      const wrapper = await mountReal();
      // The skeleton shows only once a load outlasts the loader delay.
      await new Promise((r) => setTimeout(r, LOADER_DELAY_MS + 20));

      expect(table(wrapper).classes()).toContain("[&_[data-test=o2-table-scroll-container]]:h-104");
      const skeleton = card(wrapper).find('[data-test="o2-table-skeleton-body"]');
      expect(skeleton.findAll("tr")).toHaveLength(10);
    });

    /// A larger page scrolls inside the fixed body, and the pager stays so the size can be put back.
    it("scrolls a page of 100 inside the fixed body with the pager below", async () => {
      Object.assign(useListViewState("oncall-my-deliveries", {}), { pageSize: 100 });
      answer(sent(41));
      const wrapper = await mountReal();

      expect(rendered(wrapper)).toHaveLength(41);
      expect(table(wrapper).classes()).toContain("[&_[data-test=o2-table-scroll-container]]:h-104");
      expect(pager(wrapper).exists()).toBe(true);
      expect(card(wrapper).find('[data-test="o2-table-pagination-info"]').text()).toMatch(
        /1\D+41\D+41/,
      );
      expect(card(wrapper).find('[data-test="o2-table-page-size-select"]').exists()).toBe(true);
    });

    /// The pager arrives with the rows, so the table must not keep the row model it was created with.
    it("renders ten rows and a pager for 25 rows", async () => {
      answer(sent(25));
      const wrapper = await mountReal();

      expect(rendered(wrapper)).toHaveLength(10);
      const info = () => card(wrapper).find('[data-test="o2-table-pagination-info"]').text();
      expect(info()).toMatch(/1\D+10\D+25/);
      await card(wrapper).find('[data-test="o2-table-next-page-btn"]').trigger("click");
      await flushPromises();
      expect(rendered(wrapper)).toHaveLength(10);
      expect(info()).toMatch(/11\D+20\D+25/);
    });
  });

  describe("list view state", () => {
    const defaults = { unreadOnly: false, currentPage: 1, pageSize: 20 };

    it("restores page, page size and the unread-only read", async () => {
      Object.assign(useListViewState("oncall-my-deliveries", defaults), {
        unreadOnly: true,
        currentPage: 2,
        pageSize: 50,
      });
      answer([delivery({ event_id: "ev_1" })]);
      const wrapper = render();
      await flushPromises();

      expect(service.myDeliveries).toHaveBeenCalledWith(
        expect.objectContaining({ unread_only: true }),
      );
      expect(history(wrapper).props("currentPage")).toBe(2);
      expect(history(wrapper).props("pageSize")).toBe(50);
    });

    it("saves page changes", async () => {
      answer([delivery({ event_id: "ev_1" })]);
      const wrapper = render();
      await flushPromises();
      history(wrapper).vm.$emit("update:currentPage", 3);
      await flushPromises();

      const saved = useListViewState("oncall-my-deliveries", defaults) as Record<string, unknown>;
      expect(saved.currentPage).toBe(3);
    });
  });
});
