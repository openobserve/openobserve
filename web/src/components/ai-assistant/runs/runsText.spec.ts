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

import { gt, raw } from "@/types/i18n";

import { rowSignal, runAgent, runSignal, runStatus, runsSummary, runTitle } from "./runsText";
import { runRow } from "./runsTestKit";

const counts = (over = {}) => ({ needs: 0, answering: 0, failed: 0, ready: 0, ...over });

describe("runsText", () => {
  it("picks one signal by priority: needs you, failed, ready, working", () => {
    expect(runSignal(counts({ needs: 1, failed: 2, ready: 3, answering: 4 }))).toBe("attention");
    expect(runSignal(counts({ failed: 2, ready: 3 }))).toBe("failed");
    expect(runSignal(counts({ ready: 3, answering: 4 }))).toBe("unread");
    expect(runSignal(counts({ answering: 4 }))).toBe("working");
  });

  it("gives a row the signal of its group", () => {
    expect(rowSignal(runRow("a", { group: "needs_you" }))).toBe("attention");
    expect(rowSignal(runRow("a", { group: "failed" }))).toBe("failed");
    expect(rowSignal(runRow("a", { group: "ready" }))).toBe("unread");
    expect(rowSignal(runRow("a"))).toBe("working");
  });

  it("words the summary in the order asked, dropping zero parts (PO B53)", () => {
    const all = counts({ needs: 2, answering: 1 });
    expect(runsSummary(all, ["answering", "needs"], gt)).toBe("1 answering · 2 need you");
    expect(runsSummary(all, ["needs", "answering"], gt)).toBe("2 need you · 1 answering");
    expect(runsSummary(counts({ needs: 1 }), ["answering", "needs"], gt)).toBe("1 needs you");
    expect(runsSummary(counts(), ["answering", "needs"], gt)).toBe("");
  });

  it("never leaves a row without a title", () => {
    expect(runTitle(runRow("a"), gt)).toBe("Chat a");
    expect(runTitle(runRow("a", { title: null }), gt)).toBe("New chat");
    expect(runTitle(runRow("a", { title: null, otherOrg: true, org: "acme" }), gt)).toBe(
      "A chat in acme",
    );
  });

  it("names the agent by its job, with the product for the default one", () => {
    expect(runAgent(runRow("a", { agent: "sre-rca" }), "O2", gt)).toBe("Investigator");
    expect(runAgent(runRow("a"), "O2", gt)).toBe("O2");
  });

  it("words each status with what belongs to it", () => {
    expect(runStatus(runRow("a", { startedAt: 1_000 }), 13_000, gt)).toContain("Answering · ");
    expect(runStatus(runRow("a", { startedAt: null }), 13_000, gt)).toBe("Answering");
    expect(runStatus(runRow("a", { status: "needsApproval", expiresAt: 76_000 }), 1_000, gt)).toBe(
      raw("Needs your approval · 1:15"),
    );
    expect(runStatus(runRow("a", { status: "needsApproval" }), 1_000, gt)).toBe(
      "Needs your approval",
    );
    expect(runStatus(runRow("a", { status: "elsewhere" }), 1_000, gt)).toBe(
      "Answering in another tab",
    );
    expect(runStatus(runRow("a", { status: "reconnecting" }), 1_000, gt)).toBe("Reconnecting");
    expect(runStatus(runRow("a", { status: "stopped" }), 1_000, gt)).toContain("Stopped · ");
  });
});
