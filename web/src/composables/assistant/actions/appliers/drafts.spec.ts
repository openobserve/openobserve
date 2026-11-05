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

import { describe, expect, it } from "vitest";

import { makeEnv } from "../__tests__/actionEnv";
import { alertDraftApplier, dashboardDraftApplier } from "./drafts";

const query = {
  language: "sql" as const,
  text: 'SELECT count(*) FROM "default"',
  stream: "default",
  from: 0,
  to: 0,
  org: "org1",
};

describe("drafts applier", () => {
  it("opens the alert dialog prefilled and stamped with its origin, saving nothing", async () => {
    const { env, sid, store } = makeEnv();
    store.state.sessions[sid].turnMeta.turnId = "turn-9";
    await alertDraftApplier(sid, { kind: "create_alert_draft", query }, env);
    expect(env.requestAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "assistant",
        streamName: "default",
        queryType: "sql",
        sql: query.text,
        meta: { origin: "assistant", origin_turn_id: "turn-9" },
      }),
    );
    expect(env.search).not.toHaveBeenCalled();
    expect(env.feedback).not.toHaveBeenCalled();
  });

  it("opens the dashboard picker with the query and its turn; the user's Save is the only write", async () => {
    const { env, sid } = makeEnv();
    await dashboardDraftApplier(sid, { kind: "add_to_dashboard_draft", query }, env);
    expect(env.requestDashboard).toHaveBeenCalledWith({ query, originTurnId: null });
  });

  it("names the block's own turn as the origin, not the session's latest", async () => {
    const { env, sid, store } = makeEnv();
    store.state.sessions[sid].turnMeta.turnId = "turn-9";
    await dashboardDraftApplier(
      sid,
      { kind: "add_to_dashboard_draft", query, turnId: "turn-2" },
      env,
    );
    expect(env.requestDashboard).toHaveBeenCalledWith({ query, originTurnId: "turn-2" });
    await alertDraftApplier(sid, { kind: "create_alert_draft", query, turnId: "turn-2" }, env);
    expect(env.requestAlert).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { origin: "assistant", origin_turn_id: "turn-2" } }),
    );
  });

  it("sizes the alert period from the block's window, and opens PromQL as a metrics alert", () => {
    const { env, sid } = makeEnv();
    const windowed = { ...query, from: 1_760_000_000_000, to: 1_760_000_900_000 };
    alertDraftApplier(sid, { kind: "create_alert_draft", query: windowed }, env);
    expect(env.requestAlert).toHaveBeenLastCalledWith(
      expect.objectContaining({ periodMinutes: 15 }),
    );
    const promql = { ...query, language: "promql" as const, text: "up" };
    alertDraftApplier(sid, { kind: "create_alert_draft", query: promql }, env);
    expect(env.requestAlert).toHaveBeenLastCalledWith(
      expect.objectContaining({ queryType: "promql", promql: "up", streamType: "metrics" }),
    );
  });

  it("refuses an empty query", async () => {
    const { env, sid } = makeEnv();
    expect(
      alertDraftApplier(sid, { kind: "create_alert_draft", query: { ...query, text: " " } }, env),
    ).toEqual({ ok: false, reason: "failed" });
  });

  it("refuses a VRL or regex query, which neither form can run", () => {
    const { env, sid } = makeEnv();
    const vrl = { ...query, language: "vrl" as const, text: ".a = 1" };
    expect(alertDraftApplier(sid, { kind: "create_alert_draft", query: vrl }, env)).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(dashboardDraftApplier(sid, { kind: "add_to_dashboard_draft", query: vrl }, env)).toEqual(
      { ok: false, reason: "failed" },
    );
  });
});
