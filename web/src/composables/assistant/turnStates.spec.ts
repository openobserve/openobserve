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

import { describe, expect, expectTypeOf, it } from "vitest";

import type { AssistantError, AssistantSession } from "./assistantStore.types";
import { isTerminal, type TurnState } from "./turnStates";

const error: AssistantError = {
  code: "unknown",
  phase: "post_admission",
  retryable: true,
  action: "retry",
};

const table: [TurnState, boolean][] = [
  [{ state: "idle" }, false],
  [{ state: "queued" }, false],
  [{ state: "connecting" }, false],
  [{ state: "responding.thinking" }, false],
  [{ state: "responding.writing" }, false],
  [{ state: "running_tool", tool: "SearchSQL", target: "default", callId: "c1" }, false],
  [{ state: "awaiting_approval", callId: "c1" }, false],
  [{ state: "awaiting_consent" }, false],
  [{ state: "reconnecting", attempt: 1 }, false],
  [{ state: "stopping" }, false],
  [{ state: "stopped", steps: 2, partial: true }, true],
  [{ state: "failed", error }, true],
  [{ state: "refused", error }, true],
  [{ state: "done", saved: "server" }, true],
  [{ state: "done", saved: "not_saved" }, true],
];

describe("isTerminal", () => {
  it.each(table)("%o → %s", (turn, terminal) => {
    expect(isTerminal(turn)).toBe(terminal);
  });
});

describe("AssistantSession", () => {
  it("holds no AbortController, reader or timer (00 §19 #65)", () => {
    type Values = AssistantSession[keyof AssistantSession];
    expectTypeOf<Extract<Values, AbortController>>().toBeNever();
    expectTypeOf<Extract<Values, ReadableStreamDefaultReader>>().toBeNever();
    expectTypeOf<Extract<Values, ReturnType<typeof setTimeout>>>().toBeNever();
    expectTypeOf<AssistantSession>().not.toHaveProperty("controller");
    expectTypeOf<AssistantSession>().not.toHaveProperty("reader");
    expectTypeOf<AssistantSession>().not.toHaveProperty("timer");
  });
});
