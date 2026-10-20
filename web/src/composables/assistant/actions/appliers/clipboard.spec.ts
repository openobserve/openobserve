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

import { makeEnv } from "../__tests__/actionEnv";
import { clipboardApplier } from "./clipboard";

describe("clipboard applier", () => {
  it("copies and reports success", async () => {
    const { env, sid } = makeEnv();
    await expect(
      clipboardApplier(sid, { kind: "copy", text: "SELECT 1", what: "query" }, env),
    ).resolves.toEqual({ ok: true });
    expect(env.copy).toHaveBeenCalledWith("SELECT 1");
  });

  it("fails when the browser refuses, so the control offers the text to copy by hand", async () => {
    const { env, sid } = makeEnv();
    env.copy.mockResolvedValueOnce(false);
    await expect(
      clipboardApplier(sid, { kind: "copy", text: "x", what: "query" }, env),
    ).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
  });
});
