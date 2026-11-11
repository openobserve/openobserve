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
  alertDetailQuery,
  ackAlertMutation,
  ackAlertsMutation,
  toggleAlertStateMutation,
  toggleAnomalyAlertStateMutation,
  unackAlertMutation,
  muteAlertMutation,
  extendAlertMuteMutation,
  cancelAlertMuteMutation,
} from "./alerts.queries";
import { alertKeys } from "./alerts.querykeys";
import { incidentKeys } from "./incidents.querykeys";
import { oncallKeys } from "./oncall.querykeys";
import { updateIncidentStatusMutation } from "./incidents.queries";
import {
  acknowledgeResponseMutation,
  takeOverResponseMutation,
  unacknowledgeResponseMutation,
} from "./oncall.queries";
import { downtimeKeys } from "./downtimes.querykeys";
import { announcementKeys } from "./announcements.querykeys";
import alerts from "./alerts";
import search from "./search";
import analytics from "./product_analytics";

vi.mock("./search", () => ({ default: { metrics_query: vi.fn() } }));
vi.mock("./product_analytics", () => ({ default: { track: vi.fn() } }));

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

  it("re-reads an alert once its folder is known, since the folder decides the route check", () => {
    expect(alertAcksQuery(ORG, "a1", "f1").queryKey).not.toEqual(
      alertAcksQuery(ORG, "a1").queryKey,
    );
    expect(alertDetailQuery(ORG, "a1", "f1").queryKey).not.toEqual(
      alertDetailQuery(ORG, "a1").queryKey,
    );
    expect(alertDetailQuery(ORG, "a1").queryKey).toEqual(alertKeys.detail(ORG, "a1"));
  });

  it("returns the server's ack answer and refreshes every alert read", async () => {
    vi.mocked(alerts.ackAlert).mockResolvedValue({ data: { changed: true, acks: [ACK] } } as never);
    const options = ackAlertMutation(ORG);
    const run = options.mutationFn as (v: unknown) => Promise<unknown>;
    const result = await run({ alertId: "a1", body: { all_groups: true }, folderId: "f1" });
    expect(alerts.ackAlert).toHaveBeenCalledWith(ORG, "a1", { all_groups: true }, "f1");
    expect(result).toEqual({ changed: true, acks: [ACK] });
    expect(options.meta?.silentError).toBe(true);
  });

  // One ack writes the alert rows, the incident and every page, whichever screen sent it.
  it.each([
    ["an alert ack", ackAlertMutation(ORG)],
    ["an alert unack", unackAlertMutation(ORG)],
    ["an incident status change", updateIncidentStatusMutation(ORG)],
    ["a page ack", acknowledgeResponseMutation(ORG)],
    ["a page take-over", takeOverResponseMutation(ORG)],
    ["a page unack", unacknowledgeResponseMutation(ORG)],
  ])("%s expires the alert, incident and on-call reads", (_, mutation) => {
    const scopes = mutation.meta?.invalidates ?? [];
    for (const key of [
      alertKeys.all(ORG),
      incidentKeys.all(ORG),
      oncallKeys.responsesAll(ORG),
      oncallKeys.myAll(ORG),
    ]) {
      expect(scopes).toContainEqual(key);
    }
  });

  it("counts every row of an incident one bulk ack wrote", async () => {
    const answer = (changed: boolean, id?: string) => ({
      data: { changed, acks: [], incident: id ? { id, status: "acknowledged" } : undefined },
    });
    vi.mocked(alerts.ackAlert)
      .mockResolvedValueOnce(answer(false, "inc") as any)
      .mockResolvedValueOnce(answer(true, "inc") as any)
      .mockResolvedValueOnce(answer(false, "inc") as any)
      .mockResolvedValueOnce(answer(false, "held-elsewhere") as any)
      .mockResolvedValueOnce(answer(false) as any);
    const targets = ["1", "2", "3", "4", "5"].map((alertId) => ({ alertId, body: {} }));

    const result = await (ackAlertsMutation(ORG).mutationFn as any)(targets);

    expect(result).toEqual({ acked: 3, failures: [] });
  });

  it("reports a rejected bulk ack as a failure with its reason", async () => {
    const reason = { response: { status: 409, data: { code: "firing_changed" } } };
    vi.mocked(alerts.ackAlert)
      .mockResolvedValueOnce({ data: { changed: true, acks: [] } } as any)
      .mockRejectedValueOnce(reason);
    const targets = ["1", "2"].map((alertId) => ({ alertId, body: {} }));

    const result = await (ackAlertsMutation(ORG).mutationFn as any)(targets);

    expect(result).toEqual({ acked: 1, failures: [{ alertId: "2", error: reason }] });
  });

  it("tracks an ack only when it changed something", () => {
    vi.mocked(analytics.track).mockClear();
    const single = ackAlertMutation(ORG).onSuccess as (answer: unknown) => void;
    single({ changed: false, acks: [] });
    expect(analytics.track).not.toHaveBeenCalled();
    single({ changed: true, acks: [] });
    expect(analytics.track).toHaveBeenCalledWith("alert_acknowledged", { count: 1 });

    vi.mocked(analytics.track).mockClear();
    const bulk = ackAlertsMutation(ORG).onSuccess as (result: unknown) => void;
    bulk({ acked: 0, failures: [] });
    expect(analytics.track).not.toHaveBeenCalled();
    bulk({ acked: 3, failures: [] });
    expect(analytics.track).toHaveBeenCalledWith("alert_acknowledged", { count: 3 });
  });

  it("refreshes the Firing read after a pause or resume", () => {
    expect(toggleAlertStateMutation(ORG).meta?.invalidates).toContainEqual(alertKeys.firing(ORG));
    expect(toggleAnomalyAlertStateMutation(ORG).meta?.invalidates).toContainEqual(
      alertKeys.firing(ORG),
    );
  });

  it("refreshes alerts and downtimes after a mute, and the banner after extend or cancel", async () => {
    vi.mocked(alerts.muteAlert).mockResolvedValue({ data: { downtime_id: "d1" } } as never);
    const mute = muteAlertMutation(ORG);
    await (mute.mutationFn as (v: unknown) => Promise<unknown>)({
      alertId: "a1",
      body: { minutes: 60 },
    });
    expect(alerts.muteAlert).toHaveBeenCalledWith(ORG, "a1", { minutes: 60 }, undefined);
    // A mute also snoozes the alert's open pages.
    expect(mute.meta?.invalidates).toEqual([
      alertKeys.all(ORG),
      downtimeKeys.all(ORG),
      oncallKeys.responsesAll(ORG),
      oncallKeys.myAll(ORG),
    ]);
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
