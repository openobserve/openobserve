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
import { functionErrorText } from "./functionErrorText";

describe("functionErrorText", () => {
  it("reads a list of messages one per line", () => {
    expect(functionErrorText(["first", "second"])).toBe("first\nsecond");
  });

  it('unwraps the JSON text of a list, turning \\n and \\" back into the characters', () => {
    const encoded = JSON.stringify(['error[E203]: syntax error\n  "x" is not valid']);
    expect(functionErrorText(encoded)).toBe('error[E203]: syntax error\n  "x" is not valid');
  });

  it("unwraps a JSON string literal and an error object", () => {
    expect(functionErrorText(JSON.stringify("a\nb"))).toBe("a\nb");
    expect(functionErrorText(JSON.stringify({ message: "bad\nfn" }))).toBe("bad\nfn");
  });

  it("keeps plain text, and text that only starts like JSON", () => {
    expect(functionErrorText("plain failure")).toBe("plain failure");
    expect(functionErrorText("[E203] syntax error")).toBe("[E203] syntax error");
  });

  it("is empty for nothing", () => {
    expect(functionErrorText("")).toBe("");
    expect(functionErrorText(undefined)).toBe("");
    expect(functionErrorText([])).toBe("");
  });
});
