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

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Router } from "vue-router";
import type { QueryHistoryEntry } from "@/services/query_history";
import { LOGS_REAPPLY_TYPE } from "./logs";
import { openRecentOnItsPage, recentSearchRoute, takeRecentLanding } from "./routes";
import { landingRouter, landWithoutRestore } from "@/test/unit/helpers/recentLanding";

const logsRow: QueryHistoryEntry = {
  id: "l1",
  source: "logs",
  query: 'SELECT * FROM "app"',
  query_key: "k",
  streams: ["app"],
  context: { page: { stream: "app", stream_type: "logs" } },
  status: "ok",
  starred: false,
  run_count: 1,
  created_at: 1,
  updated_at: 2,
};

describe("recentSearchRoute", () => {
  it("marks a Logs restore as a re-apply, so it replaces the page's cached query, but not a shared link", () => {
    expect(recentSearchRoute(logsRow, "original", "org1", "run")?.query.type).toBe(
      LOGS_REAPPLY_TYPE,
    );
    expect(recentSearchRoute(logsRow, "original", "org1", "load")?.query.type).toBe(
      LOGS_REAPPLY_TYPE,
    );
    expect(recentSearchRoute(logsRow, "original", "org1", "link")?.query.type).toBeUndefined();
  });
});

describe("restores that open another page", () => {
  const tracesRow: QueryHistoryEntry = {
    ...logsRow,
    id: "t1",
    source: "traces",
    streams: ["default"],
  };
  // A push that never lands: the history entry keeps whatever state the test put there.
  const pushThat = (result: Promise<unknown>) =>
    ({ push: vi.fn(() => result) }) as unknown as Router & { push: ReturnType<typeof vi.fn> };
  const pushedState = (router: { push: ReturnType<typeof vi.fn> }) =>
    (router.push.mock.calls.at(-1)?.[0] as { state: Record<string, unknown> }).state;

  afterEach(() => {
    vi.useRealTimers();
    landWithoutRestore();
  });

  it("is claimed once, by the navigation it pushed, as a load or a run", async () => {
    const { router, push } = landingRouter();
    await openRecentOnItsPage(router, logsRow, "now", "org1", false);
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/logs",
        query: expect.objectContaining({ type: LOGS_REAPPLY_TYPE }),
        state: { recentRestore: expect.any(String) },
      }),
    );
    expect(takeRecentLanding("traces")).toBeNull();
    expect(takeRecentLanding("logs")).toEqual({ run: false });
    expect(takeRecentLanding("logs")).toBeNull();

    await openRecentOnItsPage(router, logsRow, "now", "org1", true);
    expect(takeRecentLanding("logs")).toEqual({ run: true });
  });

  it("is neither claimed nor cleared by another navigation, a reload or a link", async () => {
    const router = pushThat(new Promise(() => {}));
    void openRecentOnItsPage(router, logsRow, "now", "org1", true);
    const ours = pushedState(router);
    landWithoutRestore();
    expect(takeRecentLanding("logs")).toBeNull();
    window.history.replaceState({ ...ours }, "");
    expect(takeRecentLanding("logs")).toEqual({ run: true });
  });

  it("keeps a second restore when the first one's navigation is cancelled or rejected", async () => {
    let failFirst: (failure: unknown) => void = () => {};
    let rejectSecond: (error: unknown) => void = () => {};
    const first = pushThat(new Promise((resolve) => (failFirst = resolve)));
    const second = pushThat(new Promise(() => {}));
    const third = pushThat(new Promise((_, reject) => (rejectSecond = reject)));
    const cancelled = openRecentOnItsPage(first, logsRow, "now", "org1", false);
    void openRecentOnItsPage(second, logsRow, "now", "org1", true);
    const rejected = openRecentOnItsPage(third, tracesRow, "now", "org1", true);
    failFirst({ type: 8 });
    rejectSecond(new Error("guard threw"));
    await cancelled;
    await rejected;

    window.history.replaceState({ ...pushedState(first) }, "");
    expect(takeRecentLanding("logs")).toBeNull();
    window.history.replaceState({ ...pushedState(third) }, "");
    expect(takeRecentLanding("traces")).toBeNull();
    window.history.replaceState({ ...pushedState(second) }, "");
    expect(takeRecentLanding("logs")).toEqual({ run: true });
  });

  it("expires when its page has not claimed it within 30 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
    const { router } = landingRouter();
    await openRecentOnItsPage(router, logsRow, "now", "org1", true);
    vi.setSystemTime(new Date("2026-10-28T10:00:31Z"));
    expect(takeRecentLanding("logs")).toBeNull();
  });

  it("carries nothing to a page opened from a link, a reload or a bookmark", () => {
    landWithoutRestore();
    expect(takeRecentLanding("logs")).toBeNull();
    expect(takeRecentLanding("metrics")).toBeNull();
  });
});
