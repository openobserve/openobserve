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
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import { resetListViewState, useListViewState } from "@/composables/useListViewState";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import type { MyDelivery } from "@/ts/interfaces/oncall";

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
  ODropdown: { name: "ODropdown", template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: {
    name: "ODropdownItem",
    props: ["iconLeft"],
    emits: ["select"],
    template: `<button @click="$emit('select')"><slot /></button>`,
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
const answer = (deliveries: MyDelivery[]) =>
  service.myDeliveries.mockResolvedValue({
    data: { total: deliveries.length, unread: 99, deliveries },
  } as any);

describe("OnCallMyDeliveries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    resetListViewState();
    answer([]);
    service.markDeliveriesRead.mockResolvedValue({ data: { updated: 1, unread: 0 } } as any);
    service.acknowledgeResponse.mockResolvedValue({ data: {} } as any);
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
      delivery({ event_id: "ev_3", response_id: "resp_3", subject_id: "al_other", at: AT + 2 }),
    ]);
    const wrapper = render();
    await flushPromises();

    expect(historyRows(wrapper)).toHaveLength(2);
    expect(historyRows(wrapper)[1].text()).toContain("×2");
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
  });

  describe("the unread badge", () => {
    /// A resolved page has nothing left to read, so it never counts.
    it("counts unread open pages only, and reports the count outward", async () => {
      answer([
        delivery({ event_id: "ev_1", response_id: "resp_1", read: false }),
        delivery({ event_id: "ev_2", response_id: "resp_1", read: false, channel: "sms" }),
        delivery({
          event_id: "ev_3",
          response_id: "resp_2",
          read: false,
          response_state: "resolved",
        }),
      ]);
      const wrapper = render();
      await flushPromises();

      expect(wrapper.emitted("unread")?.at(-1)).toEqual([1]);
      expect(wrapper.find('[data-test="oncall-my-deliveries-unread"]').text()).toContain("1");
    });

    it("shows no unread dot on a resolved alert", async () => {
      answer([delivery({ read: false, response_state: "resolved" })]);
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-my-delivery-unread-ev_88"]').exists()).toBe(false);
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

  /// Resolved pages are never unread, so an all-resolved inbox has nothing to filter or mark.
  it("offers no unread filter and no row menu when every page is resolved", async () => {
    answer([delivery({ read: true, response_state: "resolved" })]);
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-my-deliveries-unread-toggle"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-my-delivery-more-ev_88"]').exists()).toBe(false);
  });

  /// An empty list has nothing to narrow, so it offers no filter.
  it("offers no unread filter on an empty list", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-my-deliveries-unread-toggle"]').exists()).toBe(false);
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

    it("reads every send of an unread alert from its row menu", async () => {
      answer([
        delivery({ event_id: "ev_1", read: false, at: AT + 1 }),
        delivery({ event_id: "ev_2", read: false, channel: "sms" }),
      ]);
      const wrapper = render();
      await flushPromises();

      const toggle = wrapper.findComponent('[data-test="oncall-my-delivery-toggle-ev_1"]');
      expect(toggle.props("iconLeft")).toBe("check-circle");
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

  /// A history row is placed against a deploy or a shift by its minute, so it shows the clock time.
  it("dates a row with its clock time, not a bare date", async () => {
    answer([delivery()]);
    const wrapper = render();
    await flushPromises();

    expect(history(wrapper).text()).toMatch(/\d{4}, \d{2}:\d{2}/);
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

  /// A column of empty dots says nothing, so the unread column only exists while something is unread.
  it("leaves out the unread column when nothing is unread", async () => {
    answer([delivery({ read: true })]);
    const wrapper = render();
    await flushPromises();

    const columns = history(wrapper).findComponent({ name: "OTable" }).props("columns") as {
      id: string;
    }[];
    expect(columns.map((c) => c.id)).toEqual([
      "page",
      "team",
      "state",
      "channels",
      "at",
      "actions",
    ]);
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
