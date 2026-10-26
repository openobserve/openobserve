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

import { snippetTokenName } from "./useCredentialSnippet";

describe("snippetTokenName", () => {
  const two = [
    { name: "default", token: "a", enabled: true },
    { name: "ci", token: "b", enabled: true },
  ];

  it("names the token in the snippet when the org has more than one", () => {
    expect(snippetTokenName({ organizationPasscode: "b", orgTokens: two })).toBe("ci");
  });

  it("names nothing with one token, as a new org has", () => {
    expect(snippetTokenName({ organizationPasscode: "a", orgTokens: [two[0]] })).toBeUndefined();
  });

  it("counts only enabled tokens", () => {
    const oneEnabled = [two[0], { ...two[1], enabled: false }];
    expect(snippetTokenName({ organizationPasscode: "a", orgTokens: oneEnabled })).toBeUndefined();
  });

  it("names nothing before the passcode loads", () => {
    expect(snippetTokenName({ organizationPasscode: "", orgTokens: two })).toBeUndefined();
    expect(snippetTokenName(undefined)).toBeUndefined();
  });
});
