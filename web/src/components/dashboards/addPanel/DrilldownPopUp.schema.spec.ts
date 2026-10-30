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
import { drilldownUrlIsValid } from "./DrilldownPopUp.schema";

describe("drilldownUrlIsValid", () => {
  it("accepts http(s) templates with ${variable} placeholders", () => {
    for (const ok of [
      "https://example.com/d/${value}",
      "https://example.com/x?a=${row.field}",
      "http://localhost:5080/web/logs",
    ]) {
      expect(drilldownUrlIsValid(ok), `rejected: ${ok}`).toBe(true);
    }
  });

  // The previous regex named these schemes as ALLOWED. `window.open` is called
  // on this value, so data:/file: are navigable targets, not inert text.
  it("rejects schemes the old protocol regex explicitly allowed", () => {
    for (const bad of [
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "file:///etc/passwd",
      "telnet://host",
      "ws://host/x",
      "wss://host/x",
      "ftp://host/x",
    ]) {
      expect(drilldownUrlIsValid(bad), `accepted: ${bad}`).toBe(false);
    }
  });

  it("rejects hostile schemes and non-URLs", () => {
    for (const bad of ["javascript:alert(1)", "foo", "http://", "https://-"]) {
      expect(drilldownUrlIsValid(bad), `accepted: ${bad}`).toBe(false);
    }
  });
});
