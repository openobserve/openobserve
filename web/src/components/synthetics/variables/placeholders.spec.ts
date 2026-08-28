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
import { placeholderNames } from "./placeholders";

// The mirror of the server's placeholder_names. If the two disagree, the
// editor's unbound warning names something the server counts as used, or stays
// quiet about something that will type as literal text at run time.
describe("placeholderNames", () => {
  it("finds names with and without padding", () => {
    expect(placeholderNames("{{A}} {{ B }}")).toEqual(["A", "B"]);
  });

  it("preserves case, because substitution is an exact key lookup", () => {
    expect(placeholderNames("{{base_url}}")).toEqual(["base_url"]);
  });

  it("ignores malformed braces", () => {
    expect(placeholderNames("{{}}")).toEqual([]);
    expect(placeholderNames("{{A-B}}")).toEqual([]);
    expect(placeholderNames("no braces here")).toEqual([]);
  });

  it("reports a repeated name once per occurrence", () => {
    // The caller dedupes; reporting occurrences keeps this a parser rather
    // than a policy.
    expect(placeholderNames("{{A}} and {{A}}")).toEqual(["A", "A"]);
  });
});
