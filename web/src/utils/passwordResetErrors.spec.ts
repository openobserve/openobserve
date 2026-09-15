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

import { isPasswordResetError, isWriteRestrictedError } from "./passwordResetErrors";

const forbidden = (data: Record<string, unknown>) => ({ response: { status: 403, data } });

describe("isPasswordResetError", () => {
  it("recognises only the middleware's reset-required 403", () => {
    expect(isPasswordResetError(forbidden({ code: "password_reset_required" }))).toBe(true);
    // A plain 403 is an authorization failure and belongs to the existing handler.
    expect(isPasswordResetError(forbidden({}))).toBe(false);
    expect(isPasswordResetError({ response: { status: 401 } })).toBe(false);
    expect(isPasswordResetError(undefined)).toBe(false);
  });

  it("ignores the code on any status other than 403", () => {
    expect(
      isPasswordResetError({
        response: { status: 400, data: { code: "password_reset_required" } },
      }),
    ).toBe(false);
  });
});

describe("isWriteRestrictedError", () => {
  it("keeps the two middleware codes apart", () => {
    const restricted = forbidden({ code: "password_reset_required_for_writes" });
    const blocked = forbidden({ code: "password_reset_required" });

    expect(isWriteRestrictedError(restricted)).toBe(true);
    expect(isPasswordResetError(restricted)).toBe(false);
    expect(isWriteRestrictedError(blocked)).toBe(false);
  });

  it("is false for a plain 403 and for no error at all", () => {
    expect(isWriteRestrictedError(forbidden({}))).toBe(false);
    expect(isWriteRestrictedError(undefined)).toBe(false);
  });
});
