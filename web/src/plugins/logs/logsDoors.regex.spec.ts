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

import { beforeEach, describe, expect, it, vi } from "vitest";

const { queueDockStage } = vi.hoisted(() => ({ queueDockStage: vi.fn() }));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  queueDockStage,
}));

import { regexFieldHandoff, type LogsDoorBase } from "./logsDoors";

const base = {
  org: "default",
  stream: "checkout",
  streamType: "logs",
  range: { from: 1_000, to: 2_000 },
} as unknown as LogsDoorBase;

beforeEach(() => queueDockStage.mockClear());

describe("regexFieldHandoff", () => {
  it("queues the prompt for the regex dock and hands the bounded sample to the drawer", async () => {
    const go = vi.fn();
    await regexFieldHandoff(base, "card", "4111 1111 1111 1111", go);
    const [host, payload] = queueDockStage.mock.calls[0];
    expect(host).toBe("regex");
    expect(payload.text).toContain("in field `card`");
    expect(payload.text).not.toContain("4111");
    expect(go).toHaveBeenCalledWith({ prompt: payload.text, sample: "4111 1111 1111 1111" });
  });

  it("redacts a secret-named field's value in the chip and in the drawer's test value", async () => {
    const go = vi.fn();
    await regexFieldHandoff(base, "password", "hunter2", go);
    const [, payload] = queueDockStage.mock.calls[0];
    expect(JSON.stringify(payload.chips)).not.toContain("hunter2");
    expect(go.mock.calls[0][0].sample).not.toContain("hunter2");
  });
});
