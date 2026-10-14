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

import { describe, it, expect } from "vitest";
import { recallChatSelection, rememberChatSelection } from "./chatSelection";

describe("chatSelection", () => {
  it("recalls the remembered chat once per user+org", () => {
    rememberChatSelection("k1", 42);
    expect(recallChatSelection("k1")).toBe(42);
    expect(recallChatSelection("k1")).toBeNull();
  });

  it("forgets a selection set back to no chat", () => {
    rememberChatSelection("k2", 7);
    rememberChatSelection("k2", null);
    expect(recallChatSelection("k2")).toBeNull();
  });

  it("keeps selections of different users and orgs apart", () => {
    rememberChatSelection("k3", 1);
    rememberChatSelection("k4", 2);
    expect(recallChatSelection("k4")).toBe(2);
    expect(recallChatSelection("k3")).toBe(1);
  });
});
