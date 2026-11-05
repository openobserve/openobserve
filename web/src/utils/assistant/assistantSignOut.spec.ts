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

const { flag, onSignOut } = vi.hoisted(() => ({
  flag: { on: true },
  onSignOut: vi.fn(),
}));

vi.mock("@/composables/assistant/flags", () => ({ isAssistantV2: () => flag.on }));
vi.mock("@/composables/assistant", () => ({ assistantLifecycle: { onSignOut } }));

import { assistantSignOut } from "./assistantSignOut";

beforeEach(() => {
  flag.on = true;
  onSignOut.mockReset();
});

describe("assistantSignOut", () => {
  it("returns the assistant's answer, so a running answer can still cancel a sign-out", async () => {
    onSignOut.mockResolvedValue("cancel");
    await expect(assistantSignOut({ forced: false })).resolves.toBe("cancel");
    expect(onSignOut).toHaveBeenCalledWith({ forced: false });
  });

  it("never blocks the sign-out when the assistant throws", async () => {
    onSignOut.mockRejectedValue(new Error("chunk failed"));
    await expect(assistantSignOut({ forced: true })).resolves.toBe("proceed");
  });

  it("asks nothing with the revamp off", async () => {
    flag.on = false;
    await expect(assistantSignOut()).resolves.toBe("proceed");
    expect(onSignOut).not.toHaveBeenCalled();
  });
});
