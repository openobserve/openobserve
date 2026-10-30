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

import { usePasswordReset } from "./usePasswordReset";

const { open, close, isOpen } = usePasswordReset();

describe("usePasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    close();
  });

  it("opens once however many rejections arrive", () => {
    open("policy_tightened");
    open("rotation_expired");
    open("rotation_expired");

    expect(isOpen.value).toBe(true);
    // The first reason wins: six parallel requests must not rewrite the banner under the user.
    expect(usePasswordReset().reason.value).toBe("policy_tightened");
  });

  it("falls back to policy_tightened for an unrecognised reason", () => {
    open("something-else");

    expect(usePasswordReset().reason.value).toBe("policy_tightened");
  });
});
