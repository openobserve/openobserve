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

import { fakeAssistant } from "@/components/ai-assistant/__tests__/fakeAssistant";
import { raw } from "@/types/i18n";

import { sidTime } from "./historyContext";
import { lastTurnEndOf } from "./historyList";

describe("lastTurnEndOf", () => {
  it("names how the server says the last turn ended", () => {
    expect(lastTurnEndOf("completed")).toBe("done");
    expect(lastTurnEndOf("cancelled")).toBe("stopped");
    expect(lastTurnEndOf("failed")).toBe("failed");
    expect(lastTurnEndOf("interrupted")).toBe("failed");
  });

  it("gives a running, missing or unknown status no end", () => {
    expect(lastTurnEndOf("running")).toBeNull();
    expect(lastTurnEndOf(null)).toBeNull();
    expect(lastTurnEndOf(undefined)).toBeNull();
    expect(lastTurnEndOf("constructor")).toBeNull();
  });
});

describe("a live row's time (B-conversation-18)", () => {
  const SID = "0190f3a0-0000-7000-8000-000000000001";

  function branchWith(messages: object[]) {
    const fake = fakeAssistant("available", { persistence: false }, { uuid: () => SID }, 80, true);
    fake.history.ensureLoaded();
    const sid = fake.store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      title: "Branch of Checkout",
    });
    fake.store.state.sessions[sid].messages.push(...(messages as never[]));
    return { fake, row: () => fake.history.rows.value.find((r) => r.sid === sid)! };
  }

  it("dates a branch holding only its source's carried turns by its own creation, not the source's", () => {
    const { row } = branchWith([
      { role: "user", content: raw("why 5xx?"), turnId: "t1", sentAt: 1_000, carried: true },
      { role: "assistant", content: raw("The gateway timed out."), turnId: "t1" },
    ]);
    expect(row().updatedAt).toBe(sidTime(SID));
    expect(row().createdAt).toBe(sidTime(SID));
  });

  it("dates a branch by its own newest prompt once it has one", () => {
    const own = sidTime(SID)! + 60_000;
    const { row } = branchWith([
      { role: "user", content: raw("why 5xx?"), turnId: "t1", sentAt: 1_000, carried: true },
      { role: "user", content: raw("and now?"), turnId: "t2", sentAt: own },
    ]);
    expect(row().updatedAt).toBe(own);
  });
});
