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

import { historyRow } from "../__tests__/historyStubs";
import { runRow } from "../runs/runsTestKit";
import { titleMenuRows, type TitleMenuInput } from "./titleMenu";

const input = (over: Partial<TitleMenuInput> = {}): TitleMenuInput => ({
  runs: [],
  history: [],
  drafts: [],
  turnOf: () => undefined,
  current: null,
  ...over,
});

describe("titleMenuRows", () => {
  it("orders waiting, answering, failed, expired, drafts, then recent", () => {
    const rows = titleMenuRows(
      input({
        runs: [runRow("answer"), runRow("wait", { group: "needs_you", expiresAt: 9 })],
        drafts: [historyRow({ sid: "draft" })],
        history: [
          historyRow({ sid: "recent" }),
          historyRow({ sid: "expired" }),
          historyRow({ sid: "failed" }),
        ],
        turnOf: (sid) =>
          sid === "failed"
            ? { state: "failed", error: { code: "provider_error" } }
            : sid === "expired"
              ? { state: "failed", error: { code: "approval_expired" } }
              : undefined,
      }),
    );
    expect(rows.map((row) => [row.sid, row.status])).toEqual([
      ["wait", "needs_you"],
      ["answer", "answering"],
      ["failed", "failed"],
      ["expired", "expired"],
      ["draft", "draft"],
      ["recent", null],
    ]);
    expect(rows[0].expiresAt).toBe(9);
  });

  it("never lists the chat in view, nor a finished run as live", () => {
    const rows = titleMenuRows(
      input({
        runs: [runRow("mine"), runRow("done", { group: "ready", status: "ready" })],
        history: [historyRow({ sid: "done" })],
        current: "mine",
      }),
    );
    expect(rows.map((row) => [row.sid, row.status])).toEqual([["done", null]]);
  });

  it("reads a chat another tab saw fail as Failed", () => {
    const rows = titleMenuRows(
      input({
        runs: [runRow("x", { group: "failed", status: "failed" })],
        history: [historyRow({ sid: "x" })],
      }),
    );
    expect(rows[0].status).toBe("failed");
  });

  it("gives another org's chat its org, so the row names it and stays put", () => {
    const [row] = titleMenuRows(
      input({ runs: [runRow("x", { group: "needs_you", otherOrg: true, org: "payments" })] }),
    );
    expect(row.org).toBe("payments");
  });
});
