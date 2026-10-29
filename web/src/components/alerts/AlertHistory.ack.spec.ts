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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import AlertHistory from "@/components/alerts/AlertHistory.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { OTableRowsStub } from "@/test/unit/helpers/dropdownStubs";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { listByFolderId: vi.fn(), getHistory: vi.fn() },
  });
});
vi.mock("@/utils/date", () => ({
  formatDate: vi.fn(() => "2024-01-01 00:00:00"),
  formatToReadable: vi.fn(() => "1 day ago"),
  formatTimestamp: vi.fn(() => "1 min ago"),
  formatToTimeCompact: vi.fn(() => "Jan 1, 2024"),
}));

import alertsService from "@/services/alerts";

const run = {
  alert_name: "checkout-error-rate",
  alert_id: "a1",
  timestamp: 1_786_500_000_000_000,
  start_time: 1_786_499_997_000_000,
  end_time: 1_786_500_000_000_000,
  is_realtime: false,
  is_silenced: false,
  retries: 0,
  dedup_enabled: false,
};

const hits = [
  { ...run, status: "suppressed", acked_by: "bob@acme.io" },
  {
    ...run,
    timestamp: 1_786_499_000_000_000,
    status: "ack_event",
    acked_by: "bob@acme.io",
    ack_action: "ack",
    ack_source: "slack",
  },
  { ...run, timestamp: 1_786_498_000_000_000, status: "firing" },
];

let wrapper: VueWrapper<any>;

const mountHistory = async () => {
  wrapper = mount(AlertHistory, {
    global: {
      plugins: [i18n, store, router],
      stubs: {
        ODialog: { template: "<div />", props: ["open"] },
        DateTime: { template: "<div />" },
        OTable: OTableRowsStub,
        OSelect: { template: "<div />" },
        NoData: { template: "<div />" },
      },
    },
  });
  await flushPromises();
};

const rowsOf = () => wrapper.findAll('[data-test="otable-stub-row"]');
const cell = (row: number, col: string) => rowsOf()[row].find(`[data-col="${col}"]`);

describe("AlertHistory ack rows", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(alertsService.listByFolderId).mockResolvedValue({ data: { list: [] } } as any);
    vi.mocked(alertsService.getHistory).mockResolvedValue({
      data: { hits, total: hits.length },
    } as any);
  });
  afterEach(() => wrapper?.unmount());

  it("shows an ack-suppressed run as Acknowledged, with whose ack suppressed it", async () => {
    await mountHistory();
    expect(rowsOf()).toHaveLength(3);
    expect(cell(0, "status").text()).toContain("Acknowledged");
    expect(cell(0, "dedup").text()).toContain("suppressed by ack (bob)");
  });

  it("gives an ack event its own row with who, how and no run fields", async () => {
    await mountHistory();
    expect(cell(1, "status").text()).toContain("Ack event");
    expect(cell(1, "condition").text()).toContain("Acknowledged by bob@acme.io from Slack");
    expect(cell(1, "duration").text()).toBe("—");
    expect(cell(1, "dedup").text()).toBe("—");
  });

  it("leaves an ordinary run as it was", async () => {
    await mountHistory();
    expect(cell(2, "status").text()).toContain("Firing");
    expect(cell(2, "dedup").text()).not.toContain("suppressed by ack");
  });
});
