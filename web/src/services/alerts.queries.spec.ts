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

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  promRulePreviewQuery,
  alertHistoryQuery,
  alertAcksQuery,
  ackAlertMutation,
  unackAlertMutation,
  muteAlertMutation,
  extendAlertMuteMutation,
  cancelAlertMuteMutation,
} from "./alerts.queries";
import { alertKeys } from "./alerts.querykeys";
import { downtimeKeys } from "./downtimes.querykeys";
import { announcementKeys } from "./announcements.querykeys";
import alerts from "./alerts";
import search from "./search";

vi.mock("./search", () => ({ default: { metrics_query: vi.fn() } }));

vi.mock("./alerts", () => ({
  default: {
    getHistory: vi.fn().mockResolvedValue({ data: { hits: [], total: 0 } }),
    listAlertAcks: vi.fn(),
    ackAlert: vi.fn(),
    unackAlert: vi.fn(),
    muteAlert: vi.fn(),
    extendAlertMute: vi.fn(),
    cancelAlertMute: vi.fn(),
  },
}));

const ORG = "test-org";
// 5 s past a minute boundary, in microseconds, so +20 s stays inside the same bucket.
const END_US = 1_700_000_045_000_000;
const START_US = END_US - 5 * 60 * 1_000_000;
const BUCKETED_END_US = Math.floor(END_US / 60_000_000) * 60_000_000;

describe("alertHistoryQuery", () => {
  beforeEach(() => {
    vi.mocked(alerts.getHistory).mockClear();
  });

  it("buckets the window in the key so two opens inside the same minute share one entry", () => {
    const first = alertHistoryQuery(ORG, {
      alert_id: "a1",
      start_time: START_US,
      end_time: END_US,
    });
    // 20 s later: a different raw `now`, the same minute.
    const second = alertHistoryQuery(ORG, {
      alert_id: "a1",
      start_time: START_US + 20_000_000,
      end_time: END_US + 20_000_000,
    });
    expect(first.queryKey).toEqual(second.queryKey);
    expect(JSON.stringify(first.queryKey)).toContain(String(BUCKETED_END_US));
  });

  it("requests the caller's exact window — a bucketed end hides the current minute's evaluations", async () => {
    const options = alertHistoryQuery(ORG, {
      alert_id: "a1",
      start_time: START_US,
      end_time: END_US,
    });
    await (options.queryFn as any)();
    expect(alerts.getHistory).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ start_time: START_US, end_time: END_US }),
    );
  });
});

describe("promRulePreviewQuery", () => {
  it("counts returned series including special-value strings from an instant query", async () => {
    vi.mocked(search.metrics_query).mockResolvedValue({
      data: {
        status: "success",
        data: {
          resultType: "vector",
          result: [
            { metric: { host: "a" }, value: [600, "NaN"] },
            { metric: { host: "b" }, value: [600, "+Inf"] },
          ],
        },
      },
    } as any);
    const options = promRulePreviewQuery("org", "foo > 0", 600);
    expect(await (options.queryFn as () => Promise<number>)()).toBe(2);
    expect(search.metrics_query).toHaveBeenCalledWith({
      org_identifier: "org",
      query: "foo%20%3E%200",
      end_time: 600,
    });
  });

  it("rejects incomplete replies rather than reporting a recovery", async () => {
    vi.mocked(search.metrics_query).mockResolvedValue({
      data: {
        status: "success",
        warnings: ["partial"],
        data: { resultType: "vector", result: [] },
      },
    } as any);
    await expect(
      (promRulePreviewQuery("org", "foo", 600).queryFn as () => Promise<number>)(),
    ).rejects.toThrow("Incomplete");
  });
});

describe("ack and mute queries", () => {
  const ACK = {
    group_key: "",
    firing_started_at: 1,
    acked_by: "bob@acme.io",
    acked_at: 2,
    ack_source: "slack" as const,
  };

  it("reads the acks in force under the alert scope", async () => {
    vi.mocked(alerts.listAlertAcks).mockResolvedValue({ data: { acks: [ACK] } } as never);
    const options = alertAcksQuery(ORG, "a1");
    expect(options.queryKey).toEqual(alertKeys.acks(ORG, "a1"));
    expect(options.queryKey.slice(0, alertKeys.all(ORG).length)).toEqual(alertKeys.all(ORG));
    expect(await (options.queryFn as () => Promise<unknown>)()).toEqual([ACK]);
    expect(alerts.listAlertAcks).toHaveBeenCalledWith(ORG, "a1", undefined);
  });

  it("returns the server's ack answer and refreshes every alert read", async () => {
    vi.mocked(alerts.ackAlert).mockResolvedValue({ data: { changed: true, acks: [ACK] } } as never);
    const options = ackAlertMutation(ORG);
    const run = options.mutationFn as (v: unknown) => Promise<unknown>;
    const result = await run({ alertId: "a1", body: { all_groups: true }, folderId: "f1" });
    expect(alerts.ackAlert).toHaveBeenCalledWith(ORG, "a1", { all_groups: true }, "f1");
    expect(result).toEqual({ changed: true, acks: [ACK] });
    expect(options.meta?.invalidates).toEqual([alertKeys.all(ORG)]);
    expect(options.meta?.silentError).toBe(true);
    expect(unackAlertMutation(ORG).meta?.invalidates).toEqual([alertKeys.all(ORG)]);
  });

  it("refreshes alerts and downtimes after a mute, and the banner after extend or cancel", async () => {
    vi.mocked(alerts.muteAlert).mockResolvedValue({ data: { downtime_id: "d1" } } as never);
    const mute = muteAlertMutation(ORG);
    await (mute.mutationFn as (v: unknown) => Promise<unknown>)({
      alertId: "a1",
      body: { minutes: 60 },
    });
    expect(alerts.muteAlert).toHaveBeenCalledWith(ORG, "a1", { minutes: 60 }, undefined);
    expect(mute.meta?.invalidates).toEqual([alertKeys.all(ORG), downtimeKeys.all(ORG)]);
    expect(mute.meta?.silentError).toBe(true);

    vi.mocked(alerts.extendAlertMute).mockResolvedValue({ data: { version: 3 } } as never);
    const extend = extendAlertMuteMutation(ORG);
    await (extend.mutationFn as (v: unknown) => Promise<unknown>)({
      alertId: "a1",
      downtimeId: "d1",
      body: { version: 2, until_clear: true },
    });
    expect(alerts.extendAlertMute).toHaveBeenCalledWith(
      ORG,
      "a1",
      "d1",
      { version: 2, until_clear: true },
      undefined,
    );
    const withBanner = [alertKeys.all(ORG), downtimeKeys.all(ORG), announcementKeys.all(ORG)];
    expect(extend.meta?.invalidates).toEqual(withBanner);

    const cancel = cancelAlertMuteMutation(ORG);
    await (cancel.mutationFn as (v: unknown) => Promise<unknown>)({
      alertId: "a1",
      downtimeId: "d1",
    });
    expect(alerts.cancelAlertMute).toHaveBeenCalledWith(ORG, "a1", "d1", undefined);
    expect(cancel.meta?.invalidates).toEqual(withBanner);
  });
});
