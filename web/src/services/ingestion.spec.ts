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
import { toRecentRejections } from "./ingestion";

describe("toRecentRejections", () => {
  it("maps first_seen and token_name, newest first-seen first", () => {
    const out = toRecentRejections({
      tracked: true,
      list: [
        {
          first_seen: 10,
          status: 401,
          reason: "invalid_credentials",
          path: "/a",
          token_name: "ci",
        },
        { first_seen: 30, status: 400, reason: "malformed_body", path: "/b" },
        { firstSeen: 20, status: 413, reason: "batch_too_large", path: "/c", tokenName: "dev" },
      ],
    });
    expect(out).toEqual({
      tracked: true,
      list: [
        { firstSeen: 30, status: 400, reason: "malformed_body", path: "/b" },
        { firstSeen: 20, status: 413, reason: "batch_too_large", path: "/c", tokenName: "dev" },
        { firstSeen: 10, status: 401, reason: "invalid_credentials", path: "/a", tokenName: "ci" },
      ],
    });
  });

  it("keeps tracked false and reads a missing tracked or list as tracked and empty", () => {
    expect(toRecentRejections({ tracked: false, list: [] })).toEqual({ tracked: false, list: [] });
    expect(toRecentRejections({})).toEqual({ tracked: true, list: [] });
    expect(toRecentRejections(undefined)).toEqual({ tracked: true, list: [] });
  });
});
