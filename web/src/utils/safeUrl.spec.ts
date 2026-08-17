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
import { isSafeNavigableUrl, isSameOriginRedirect } from "./safeUrl";

describe("isSafeNavigableUrl", () => {
  it("accepts absolute http(s) URLs", () => {
    for (const ok of [
      "https://example.com",
      "http://example.com/path?q=1#f",
      "https://example.com:8443/x",
      "https://user:pass@example.com/x",
      "https://192.168.1.1/x",
      "https://[::1]:8080/x",
      "HTTPS://EXAMPLE.COM/X",
    ]) {
      expect(isSafeNavigableUrl(ok), `rejected: ${ok}`).toBe(true);
    }
  });

  it("rejects active-content schemes, including blocklist bypasses", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "\u0000javascript:alert(1)",
      "vbscript:msgbox(1)",
      // Explicitly allowed by the old drilldown regex — both are unsafe.
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "file:///etc/passwd",
      "telnet://host",
      "ws://host",
    ]) {
      expect(isSafeNavigableUrl(bad), `accepted: ${bad}`).toBe(false);
    }
  });

  it("rejects an allowlisted scheme with no host (a WHATWG parse failure)", () => {
    for (const bad of ["http:", "http://", "https://", "http:///", "http://?q=1", "http://#f"]) {
      expect(isSafeNavigableUrl(bad), `accepted: ${bad}`).toBe(false);
    }
  });

  it("rejects hosts that parse but cannot resolve", () => {
    for (const bad of ["https://.", "http://..", "https://-", "http://.:80"]) {
      expect(isSafeNavigableUrl(bad), `accepted: ${bad}`).toBe(false);
    }
  });

  it("rejects values that are not URLs at all", () => {
    for (const bad of ["", "   ", "foo", "javascript(0)", "not a url at all"]) {
      expect(isSafeNavigableUrl(bad), `accepted: ${bad}`).toBe(false);
    }
  });

  it("optionally allows mailto: for link targets", () => {
    expect(isSafeNavigableUrl("mailto:on@call.com")).toBe(false);
    expect(isSafeNavigableUrl("mailto:on@call.com", { allowMailto: true })).toBe(true);
    // Still needs a real mailbox.
    expect(isSafeNavigableUrl("mailto:", { allowMailto: true })).toBe(false);
    expect(isSafeNavigableUrl("mailto:foo", { allowMailto: true })).toBe(false);
  });

  it("optionally allows a {variable} template that resolves at render time", () => {
    expect(isSafeNavigableUrl("{alert_url}")).toBe(false);
    expect(isSafeNavigableUrl("{alert_url}", { allowTemplateVars: true })).toBe(true);
    expect(isSafeNavigableUrl("https://x.example/{field}", { allowTemplateVars: true })).toBe(true);
    // A variable elsewhere does not excuse a literal hostile scheme.
    expect(isSafeNavigableUrl("{x}javascript:alert(1)", { allowTemplateVars: true })).toBe(false);
  });
});

describe("isSameOriginRedirect", () => {
  const ORIGIN = "https://app.example.com";

  it("accepts a relative path", () => {
    for (const ok of ["/web/logs", "/", "/a?b=1#c"]) {
      expect(isSameOriginRedirect(ok, ORIGIN), `rejected: ${ok}`).toBe(true);
    }
  });

  it("accepts an absolute URL on the SAME origin", () => {
    expect(isSameOriginRedirect(`${ORIGIN}/web/logs`, ORIGIN)).toBe(true);
  });

  it("rejects an absolute URL on a DIFFERENT origin", () => {
    // The old check was `redirectURI.includes("http")`, which let every one
    // of these through and redirected the user off-site after login.
    for (const bad of [
      "https://evil.com/",
      "http://evil.com/",
      "https://app.example.com.evil.com/", // lookalike host
      "//evil.com/", // protocol-relative
      "https://app.example.com:8443/x", // different port = different origin
    ]) {
      expect(isSameOriginRedirect(bad, ORIGIN), `accepted: ${bad}`).toBe(false);
    }
  });

  it("rejects hostile schemes and backslash tricks", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "\\\\evil.com", "/\\evil.com"]) {
      expect(isSameOriginRedirect(bad, ORIGIN), `accepted: ${bad}`).toBe(false);
    }
  });

  it("rejects empty/nullish input", () => {
    expect(isSameOriginRedirect("", ORIGIN)).toBe(false);
    expect(isSameOriginRedirect(null, ORIGIN)).toBe(false);
  });
});
