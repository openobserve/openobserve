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
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import type { MyDelivery } from "@/ts/interfaces/oncall";

vi.mock("@/services/oncall", () => ({
  default: { myDeliveries: vi.fn(), markDeliveriesRead: vi.fn() },
}));

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const service = vi.mocked(oncallService);

const stubs = {
  OTable: {
    name: "OTable",
    props: ["data", "columns"],
    emits: ["row-click"],
    template: `<div>
      <div v-for="(row, i) in (data || [])" :key="i" data-test="row" @click="$emit('row-click', row)">
        <slot v-for="c in (columns || [])" :key="c.id" :name="'cell-' + c.id" :row="row" />
      </div>
    </div>`,
  },
  OEmptyState: { name: "OEmptyState", props: ["description"], template: "<div>{{ description }}</div>" },
  // `type` and `value` are declared so the state chip can be asserted on: an
  // undeclared prop lands in attrs and `props("value")` reads undefined.
  OTag: { name: "OTag", props: ["variant", "type", "value"], template: "<span><slot /></span>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OButton: {
    name: "OButton",
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

/// The delivery ledger answers "did it reach them" per RECORD. Nobody paged at
/// 3am opens twenty records to find out whether their own phone was one of
/// them, and until this screen that was the only way — the endpoint returned
/// `total: 19, unread: 19` and its name appeared nowhere in `web/`.
describe("OnCallMyDeliveries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.myDeliveries.mockResolvedValue({
      data: { total: 0, unread: 0, deliveries: [] },
    } as any);
    service.markDeliveriesRead.mockResolvedValue({ data: { updated: 1, unread: 0 } } as any);
  });

  it("says whether a page reached the reader, per row", async () => {
    service.myDeliveries.mockResolvedValue({
      data: {
        total: 2,
        unread: 0,
        deliveries: [
          delivery({ event_id: "ev_ok", delivered: true }),
          delivery({ event_id: "ev_bad", delivered: false }),
        ],
      },
    } as any);

    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-my-delivery-landed-ev_ok"]').text()).toContain(
      "Reached you",
    );
    expect(wrapper.find('[data-test="oncall-my-delivery-landed-ev_bad"]').text()).toContain(
      "did not reach you",
    );
  });

  /// `response_state` is the state NOW, not when the page went out. A row for
  /// something already resolved has to say so, or somebody chases a fire that
  /// is already out.
  it("renders the record's current state, not its state when paged", async () => {
    service.myDeliveries.mockResolvedValue({
      data: {
        total: 1,
        unread: 0,
        deliveries: [delivery({ response_state: "resolved" })],
      },
    } as any);

    const wrapper = render();
    await flushPromises();

    const tags = wrapper.findAllComponents({ name: "OTag" });
    expect(tags.some((tag) => tag.props("value") === "resolved")).toBe(true);
  });

  it("names the team rather than its id when it can", async () => {
    service.myDeliveries.mockResolvedValue({
      data: { total: 1, unread: 0, deliveries: [delivery()] },
    } as any);

    const wrapper = render({ teamNames: { team_platform: "Platform" } });
    await flushPromises();

    expect(wrapper.text()).toContain("Platform");
  });

  describe("the unread badge", () => {
    it("reports the count outward, so a caller can badge it", async () => {
      service.myDeliveries.mockResolvedValue({
        data: { total: 9, unread: 3, deliveries: [delivery({ read: false })] },
      } as any);

      const wrapper = render();
      await flushPromises();

      expect(wrapper.emitted("unread")?.at(-1)).toEqual([3]);
    });

    /// `unread` deliberately ignores the filter — it is the badge, and "3
    /// unread" must not change because somebody ticked "unread only".
    it("keeps the count from the response rather than counting the rows", async () => {
      service.myDeliveries.mockResolvedValue({
        data: { total: 1, unread: 7, deliveries: [delivery({ read: false })] },
      } as any);

      const wrapper = render();
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-my-deliveries-unread"]').text()).toContain("7");
    });
  });

  it("asks for unread only when the filter is on", async () => {
    const wrapper = render();
    await flushPromises();

    await wrapper.find('[data-test="oncall-my-deliveries-unread-toggle"]').trigger("click");
    await flushPromises();

    expect(service.myDeliveries.mock.calls.at(-1)![0]).toMatchObject({ unread_only: true });
  });

  describe("marking read", () => {
    it("clears the whole inbox in one call", async () => {
      service.myDeliveries.mockResolvedValue({
        data: { total: 1, unread: 1, deliveries: [delivery({ read: false })] },
      } as any);

      const wrapper = render();
      await flushPromises();

      await wrapper.find('[data-test="oncall-my-deliveries-read-all"]').trigger("click");
      await flushPromises();

      expect(service.markDeliveriesRead).toHaveBeenCalledWith(
        expect.objectContaining({ data: { all: true, read: true } }),
      );
    });

    /// Somebody who dismissed a page by accident at 3am has to be able to put
    /// it back, and the server takes `read: false` for exactly that.
    it("puts a row back to unread", async () => {
      service.myDeliveries.mockResolvedValue({
        data: { total: 1, unread: 0, deliveries: [delivery({ read: true })] },
      } as any);

      const wrapper = render();
      await flushPromises();

      await wrapper.find('[data-test="oncall-my-delivery-toggle-ev_88"]').trigger("click");
      await flushPromises();

      expect(service.markDeliveriesRead).toHaveBeenCalledWith(
        expect.objectContaining({ data: { event_ids: ["ev_88"], read: false } }),
      );
    });

    /// The count travels back on the write, so the badge is right without a
    /// second request — and right even when some ids were already read.
    it("takes the new count from the write's own response", async () => {
      service.myDeliveries.mockResolvedValue({
        data: { total: 1, unread: 4, deliveries: [delivery({ read: false })] },
      } as any);
      service.markDeliveriesRead.mockResolvedValue({
        data: { updated: 1, unread: 2 },
      } as any);

      const wrapper = render();
      await flushPromises();
      await wrapper.find('[data-test="oncall-my-delivery-toggle-ev_88"]').trigger("click");
      await flushPromises();

      expect(wrapper.emitted("unread")?.some((e) => e[0] === 2)).toBe(true);
    });
  });

  it("opens the page a row was sent for", async () => {
    service.myDeliveries.mockResolvedValue({
      data: { total: 1, unread: 0, deliveries: [delivery()] },
    } as any);

    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-test="row"]').trigger("click");

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "onCallResponseDetail",
        params: { responseId: "resp_1" },
      }),
    );
  });

  it("says which kind of empty it is", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("Nothing has been sent to you yet");

    await wrapper.find('[data-test="oncall-my-deliveries-unread-toggle"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Nothing unread");
  });
});
