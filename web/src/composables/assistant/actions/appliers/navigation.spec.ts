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

import { makeEnv } from "../__tests__/actionEnv";
import { navigationApplier } from "./navigation";

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

  it("never pushes on a frame's arrival: only this click navigates", () => {
    const { router } = makeEnv();
    expect(router.push).not.toHaveBeenCalled();
  });
});
