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

import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { armHomeReturn, decodeHomeReturn } from "@/composables/goto/homeReturn";
import { decodeAssistantSet } from "../../assistantSet";
import { makeEnv } from "../__tests__/actionEnv";
import { navigationApplier } from "./navigation";

const lastQuery = (push: { mock: { calls: unknown[][] } }) =>
  (push.mock.calls[0][0] as { query: Record<string, string> }).query;

describe("navigation applier", () => {
  it("pushes only the allowlisted route, with the session's org set last", async () => {
    const { env, sid, router } = makeEnv();
    const result = await navigationApplier(
      sid,
      {
        kind: "navigate",
        target: { name: "viewDashboard", query: { dashboard: "d1", org_identifier: "evil" } },
        label: "x" as any,
      },
      env,
    );
    expect(result).toEqual({ ok: true, detail: { newTab: false } });
    expect(router.push).toHaveBeenCalledWith({
      name: "viewDashboard",
      params: {},
      query: { dashboard: "d1", org_identifier: "org1" },
    });
  });

  it("refuses a route off the allowlist before the router sees it", async () => {
    const { env, sid, router } = makeEnv();
    const result = await navigationApplier(
      sid,
      { kind: "navigate", target: { name: "logout" }, label: "x" as any },
      env,
    );
    expect(result).toEqual({ ok: false, reason: "failed" });
    expect(router.push).not.toHaveBeenCalled();
  });

  it("re-mints the nonce of an explorer target at the click", async () => {
    const { env, sid, router } = makeEnv();
    await navigationApplier(
      sid,
      {
        kind: "navigate",
        target: { name: "logs", query: { type: "ai_chat_query", t: "" } },
        label: "x" as any,
      },
      env,
    );
    expect(router.push.mock.calls[0][0]).toMatchObject({ query: { t: "2000000" } });
  });

  it("mints a nonce for a service link, so an open Traces page re-applies it", async () => {
    const { env, sid, router } = makeEnv();
    await navigationApplier(
      sid,
      {
        kind: "navigate",
        target: { name: "traces", query: { tab: "services-catalog", service: "checkout" } },
        label: "x" as any,
      },
      env,
    );
    expect(router.push.mock.calls[0][0]).toMatchObject({
      name: "traces",
      query: { tab: "services-catalog", service: "checkout", t: "2000000" },
    });
  });

  it("reports a declined leave guard so the card records blocked_unsaved", async () => {
    const { env, sid } = makeEnv();
    const guarded = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/logs", name: "logs", component: { render: () => null } }],
    });
    guarded.beforeEach(() => false);
    env.router = () => guarded;
    const result = await navigationApplier(
      sid,
      { kind: "navigate", target: { name: "logs" }, label: "x" as any },
      env,
    );
    expect(result).toEqual({ ok: false, reason: "guard_declined" });
  });

  it("opens a new tab from a docked container, never a push", async () => {
    const { env, sid, router, store } = makeEnv();
    store.state.shell.placement = { kind: "docked", hostId: "alert_query" };
    const result = await navigationApplier(
      sid,
      { kind: "navigate", target: { name: "logs" }, label: "x" as any },
      env,
    );
    expect(result).toEqual({ ok: true, detail: { newTab: true } });
    expect(router.push).not.toHaveBeenCalled();
    expect(env.openTab).toHaveBeenCalledWith("/web/logs");
  });

  it("opens a new tab when a mounted host has unsaved changes", async () => {
    const { env, sid, router } = makeEnv();
    (env.hosts as { mounted: unknown }).mounted = { value: ["alert_query"] };
    vi.mocked(env.hosts.get).mockReturnValue({ isDirty: () => true } as never);
    const result = await navigationApplier(
      sid,
      { kind: "navigate", target: { name: "logs" }, label: "x" as any },
      env,
    );
    expect(result).toEqual({ ok: true, detail: { newTab: true } });
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each([
    ["home", { home_tab: "overview", org_identifier: "org1" }],
    ["ingestion", { org_identifier: "org1" }],
  ])("opens %s, which link cards may now name", async (name, query) => {
    const { env, sid, router } = makeEnv();
    const result = await navigationApplier(
      sid,
      { kind: "navigate", target: { name, query: {} }, label: "x" as any },
      env,
    );
    expect(result).toEqual({ ok: true, detail: { newTab: false } });
    expect(router.push).toHaveBeenCalledWith({ name, params: {}, query });
  });

  it("adds home_return only for a session an Investigate armed, before org_identifier", async () => {
    const plain = makeEnv();
    await navigationApplier(
      plain.sid,
      { kind: "navigate", target: { name: "alertList", query: {} }, label: "x" as any },
      plain.env,
    );
    expect(lastQuery(plain.router.push)).not.toHaveProperty("home_return");
    const armed = makeEnv();
    armHomeReturn(armed.sid, { row: "service:checkout-api", period: "1h" });
    await navigationApplier(
      armed.sid,
      {
        kind: "navigate",
        target: { name: "alertList", query: { folder: "p" } },
        label: "x" as any,
      },
      armed.env,
    );
    const query = lastQuery(armed.router.push);
    expect(decodeHomeReturn(query.home_return)).toEqual({
      row: "service:checkout-api",
      period: "1h",
    });
    expect(Object.keys(query)).toEqual(["folder", "home_return", "org_identifier"]);
  });

  it("puts home_return on the new-tab href too", async () => {
    const { env, sid, router, store } = makeEnv();
    armHomeReturn(sid, { row: "incident:i1" });
    store.state.shell.placement = { kind: "docked", hostId: "alert_query" };
    await navigationApplier(
      sid,
      { kind: "navigate", target: { name: "incidentList", query: {} }, label: "x" as any },
      env,
    );
    const resolved = router.resolve.mock.calls[0][0] as unknown as {
      query: Record<string, string>;
    };
    expect(decodeHomeReturn(resolved.query.home_return)).toEqual({ row: "incident:i1" });
    expect(Object.keys(resolved.query).at(-1)).toBe("org_identifier");
    expect(env.openTab).toHaveBeenCalled();
  });

  it("opens Back to Overview on the armed row and range, in Home's own keys", async () => {
    const { env, sid, router } = makeEnv();
    armHomeReturn(sid, { row: "service:checkout-api", from: 100, to: 200 });
    await navigationApplier(
      sid,
      { kind: "navigate", target: { name: "home", query: {} }, label: "x" as any },
      env,
    );
    expect(lastQuery(router.push)).toEqual({
      home_tab: "overview",
      row: "service:checkout-api",
      from: "100",
      to: "200",
      org_identifier: "org1",
    });
  });

  it("stamps assistant_set on a Traces target with the fields the link set", async () => {
    const { env, sid, router } = makeEnv();
    await navigationApplier(
      sid,
      {
        kind: "navigate",
        target: {
          name: "traces",
          query: {
            org_identifier: "evil",
            type: "ai_chat_query",
            t: "",
            stream: "default",
            query: "cT0x",
            from: "1",
            to: "2",
          },
        },
        label: "x" as any,
      },
      env,
    );
    const query = lastQuery(router.push);
    expect([...decodeAssistantSet(query.assistant_set)]).toEqual(["query", "stream", "time"]);
    expect(Object.keys(query).at(-1)).toBe("org_identifier");
    expect(query.org_identifier).toBe("org1");
  });

  it("names only the fields present, and never stamps another route", async () => {
    const traces = makeEnv();
    await navigationApplier(
      traces.sid,
      {
        kind: "navigate",
        target: { name: "traces", query: { tab: "services-catalog", stream: "default" } },
        label: "x" as any,
      },
      traces.env,
    );
    expect(lastQuery(traces.router.push).assistant_set).toBe("stream");
    const periodOnly = makeEnv();
    await navigationApplier(
      periodOnly.sid,
      { kind: "navigate", target: { name: "traces", query: { period: "15m" } }, label: "x" as any },
      periodOnly.env,
    );
    expect(lastQuery(periodOnly.router.push).assistant_set).toBe("time");
    const bare = makeEnv();
    await navigationApplier(
      bare.sid,
      {
        kind: "navigate",
        target: { name: "traces", query: { tab: "service-graph" } },
        label: "x" as any,
      },
      bare.env,
    );
    expect(lastQuery(bare.router.push)).not.toHaveProperty("assistant_set");
    const logs = makeEnv();
    await navigationApplier(
      logs.sid,
      {
        kind: "navigate",
        target: { name: "logs", query: { stream: "default", period: "15m" } },
        label: "x" as any,
      },
      logs.env,
    );
    expect(lastQuery(logs.router.push)).not.toHaveProperty("assistant_set");
  });

  it("never pushes on a frame's arrival: only this click navigates", () => {
    const { router } = makeEnv();
    expect(router.push).not.toHaveBeenCalled();
  });
});
