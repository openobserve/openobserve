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

import { b64DecodeUnicode } from "@/utils/formatters";

import { makeEnv } from "../__tests__/actionEnv";
import { explorerApplier } from "./explorer";

const query = {
  language: "sql" as const,
  text: 'SELECT * FROM "default"',
  stream: "default",
  from: 1_760_000_000_000,
  to: 1_760_000_900_000,
  org: "other",
};

describe("explorer applier", () => {
  it("opens Logs with the exact SQL, stream and absolute range, applied and never run", async () => {
    const { env, sid, router } = makeEnv();
    await expect(
      explorerApplier(sid, { kind: "open_in_explorer", query, explorer: "logs" }, env),
    ).resolves.toEqual({
      ok: true,
      detail: { newTab: false },
    });
    const pushed = router.push.mock.calls[0][0] as { name: string; query: Record<string, string> };
    expect(pushed.name).toBe("logs");
    expect(pushed.query).toMatchObject({
      org_identifier: "org1",
      stream: "default",
      from: "1760000000000000",
      to: "1760000900000000",
      type: "ai_chat_query",
      t: "2000000",
    });
    expect(b64DecodeUnicode(pushed.query.query)).toBe(query.text);
    expect(pushed.query).not.toHaveProperty("run");
  });

  it("opens a new tab with noopener from a docked container", async () => {
    const { env, sid, store, router } = makeEnv();
    store.state.shell.placement = { kind: "docked", hostId: "alert_query" };
    await explorerApplier(sid, { kind: "open_in_explorer", query, explorer: "metrics" }, env);
    expect(router.push).not.toHaveBeenCalled();
    expect(env.openTab).toHaveBeenCalledWith("/web/metricsEditor");
  });
});
