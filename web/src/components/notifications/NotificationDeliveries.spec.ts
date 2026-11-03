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
import store from "@/test/unit/helpers/store";

vi.mock("@/services/notification_deliveries", () => ({
  default: { list: vi.fn() },
}));

import NotificationDeliveries from "./NotificationDeliveries.vue";
import notificationDeliveries from "@/services/notification_deliveries";

const list = vi.mocked(notificationDeliveries.list);

const row = (over: Record<string, unknown>) => ({
  id: "r1",
  kind: "synthetics",
  object_id: "chk",
  episode_id: "chk:1",
  event: "firing:run_1",
  destination: "slack-ops",
  channel: "slack",
  template_source: "compiled",
  template_name: "o2_default_synthetics",
  status: "sent",
  status_code: 200,
  attempt: 1,
  max_attempts: 5,
  retryable: false,
  error: null,
  skip_reason: null,
  claimed_at: 1,
  finished_at: 2,
  next_retry_at: null,
  ...over,
});

async function mountRows(props: Record<string, unknown>) {
  const wrapper = mount(NotificationDeliveries, {
    props: { kind: "synthetics", objectId: "chk", ...props },
    global: { plugins: [i18n, store] },
  });
  await flushPromises();
  return wrapper;
}

describe("NotificationDeliveries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows one row per destination with its status and error for one run", async () => {
    list.mockResolvedValue({
      data: {
        hits: [
          row({}),
          row({
            id: "r2",
            destination: "pd-prod",
            channel: "pagerduty",
            status: "failed",
            attempt: 2,
            error: "503 Service Unavailable",
          }),
          row({ id: "r3", event: "firing:run_2", destination: "other-run" }),
        ],
      },
    } as any);
    const w = await mountRows({ eventSuffix: "run_1" });

    expect(list).toHaveBeenCalledWith(store.state.selectedOrganization.identifier, {
      kind: "synthetics",
      object_id: "chk",
      episode_id: undefined,
      event: undefined,
      size: 50,
    });
    expect(w.find('[data-test="notification-deliveries-row-other-run"]').exists()).toBe(false);
    const failed = w.find('[data-test="notification-deliveries-row-pd-prod"]');
    expect(failed.text()).toContain("Failed");
    expect(failed.text()).toContain("503 Service Unavailable");
    expect(failed.text()).toContain("2 of 5");
    expect(w.find('[data-test="notification-deliveries-row-slack-ops"]').text()).toContain("Sent");
  });

  it("shows the empty text and the permission text", async () => {
    list.mockResolvedValueOnce({ data: { hits: [] } } as any);
    const empty = await mountRows({});
    expect(empty.find('[data-test="notification-deliveries-empty"]').exists()).toBe(true);

    list.mockRejectedValueOnce({ response: { status: 403 } });
    const forbidden = await mountRows({});
    expect(forbidden.find('[data-test="notification-deliveries-forbidden"]').exists()).toBe(true);
  });

  it("offers a retry after a load error", async () => {
    list.mockRejectedValueOnce({ response: { status: 500 } });
    const w = await mountRows({});
    list.mockResolvedValueOnce({ data: { hits: [row({})] } } as any);
    await w.find('[data-test="notification-deliveries-retry"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="notification-deliveries-table"]').exists()).toBe(true);
  });
});
