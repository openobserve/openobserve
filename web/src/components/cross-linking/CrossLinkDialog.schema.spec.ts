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
import { crossLinkUrlIsValid } from "./CrossLinkDialog.schema";

// A cross-link URL is handed to window.open for EVERY viewer of the stream,
// and previously the only rule was `min(1)`.
describe("crossLinkUrlIsValid", () => {
  it("accepts http(s) templates with ${field} placeholders", () => {
    for (const ok of [
      "https://example.com/trace/${field.__value}",
      "https://example.com/x?from=${start_time}&to=${end_time}",
      "http://localhost:5080/web/logs",
      "https://example.com",
    ]) {
      expect(crossLinkUrlIsValid(ok), `rejected: ${ok}`).toBe(true);
    }
  });

  it("rejects hostile schemes", () => {
    for (const bad of [
      "javascript:alert(1)",
      "javascript:alert(document.cookie)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
    ]) {
      expect(crossLinkUrlIsValid(bad), `accepted: ${bad}`).toBe(false);
    }
  });

  it("rejects values that are not URLs", () => {
    for (const bad of ["foo", "not a url", "http:", "http://", "https://."]) {
      expect(crossLinkUrlIsValid(bad), `accepted: ${bad}`).toBe(false);
    }
  });
});
