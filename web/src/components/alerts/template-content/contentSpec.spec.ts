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
import {
  emptyContentSpec,
  linkUrlBadScheme,
  NOT_A_URL,
  starterContentSpec,
  hasOptionalContent,
  parseContentSpec,
  serializeContentSpec,
  type ContentSpec,
} from "./contentSpec";

// Known-variable list the substitution chain supports (see
// src/service/alerts/... notification templating). Kept local to the test so
// it fails loudly if starterContentSpec ever references an unknown token.
const KNOWN_VARIABLES = [
  "org_name",
  "stream_type",
  "stream_name",
  "alert_name",
  "alert_type",
  "alert_period",
  "alert_operator",
  "alert_threshold",
  "alert_count",
  "alert_agg_value",
  "alert_description",
  "alert_start_time",
  "alert_end_time",
  "alert_url",
  "alert_trigger_time",
  "alert_trigger_time_millis",
  "alert_trigger_time_seconds",
  "alert_trigger_time_str",
];

describe("contentSpec", () => {
  it("emptyContentSpec defaults", () => {
    const spec = emptyContentSpec();
    expect(spec.title).toBe("");
    expect(spec.title_overrides).toEqual({});
    expect(spec.body).toBe("");
    expect(spec.fields).toEqual([]);
    expect(spec.rows).toEqual({ enabled: false, max: 5, columns: null, format: null });
    expect(spec.links).toEqual([]);
    expect(spec.chart).toEqual({ enabled: false });
  });

  it("round-trips a full spec through serialize -> parse", () => {
    const spec: ContentSpec = {
      title: "Alert: {alert_name}",
      title_overrides: { slack: "Slack title", email: "Email subject" },
      body: "Something happened on {stream_name}",
      fields: [
        { label: "Severity", value: "{alert_severity}", show_when: { levels: ["critical"] } },
        { label: "Count", value: "{alert_count}" },
      ],
      rows: {
        enabled: true,
        max: 10,
        columns: ["timestamp", "message"],
        format: "{timestamp} {message}",
      },
      links: [{ label: "View alert", url: "{alert_url}", show_when: null }],
      chart: { enabled: false },
    };

    const serialized = serializeContentSpec(spec);
    const parsed = parseContentSpec(serialized);
    expect(parsed).toEqual(spec);
  });

  describe("serializeContentSpec — body trim on save", () => {
    it("trims leading/trailing whitespace and blank lines from body", () => {
      const spec = { ...emptyContentSpec(), body: "\n\n  hello\nworld  \n\n\n" };
      const serialized = serializeContentSpec(spec);
      const parsed = parseContentSpec(serialized)!;
      expect(parsed.body).toBe("hello\nworld");
    });

    it("does NOT trim blank lines or whitespace in the MIDDLE of the body", () => {
      // The bug this guards against: a save-time trim must never touch
      // interior structure, only the outer edges — mid-body blank lines are
      // meaningful markdown paragraph breaks, not incidental whitespace.
      const spec = { ...emptyContentSpec(), body: "para one\n\n\npara two" };
      const parsed = parseContentSpec(serializeContentSpec(spec))!;
      expect(parsed.body).toBe("para one\n\n\npara two");
    });

    it("leaves an already-trimmed body untouched", () => {
      const spec = { ...emptyContentSpec(), body: "no surrounding whitespace" };
      const parsed = parseContentSpec(serializeContentSpec(spec))!;
      expect(parsed.body).toBe("no surrounding whitespace");
    });

    it("does not mutate the original spec object passed in", () => {
      const spec = { ...emptyContentSpec(), body: "  padded  " };
      serializeContentSpec(spec);
      expect(spec.body).toBe("  padded  ");
    });

    it("reduces an all-whitespace body to an empty string", () => {
      const spec = { ...emptyContentSpec(), body: "   \n\n  \n" };
      const parsed = parseContentSpec(serializeContentSpec(spec))!;
      expect(parsed.body).toBe("");
    });
  });

  it("parseContentSpec returns null on non-JSON input", () => {
    expect(parseContentSpec("not json")).toBeNull();
    expect(parseContentSpec("")).toBeNull();
    expect(parseContentSpec("{ unterminated")).toBeNull();
  });

  it("parseContentSpec returns null for JSON that is not an object (array/primitive)", () => {
    expect(parseContentSpec("[1,2,3]")).toBeNull();
    expect(parseContentSpec("42")).toBeNull();
    expect(parseContentSpec('"a string"')).toBeNull();
  });

  it("fills in defaults for missing keys without throwing", () => {
    const parsed = parseContentSpec(JSON.stringify({ title: "Only a title" }));
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("Only a title");
    expect(parsed?.fields).toEqual([]);
    expect(parsed?.rows).toEqual({ enabled: false, max: 5, columns: null, format: null });
    expect(parsed?.links).toEqual([]);
    expect(parsed?.chart).toEqual({ enabled: false });
    expect(parsed?.title_overrides).toEqual({});
  });

  it("preserves unknown/extra top-level keys without throwing", () => {
    const parsed = parseContentSpec(
      JSON.stringify({ title: "T", future_field: "some-new-thing", nested: { a: 1 } }),
    );
    expect(parsed).not.toBeNull();
    expect((parsed as any).future_field).toBe("some-new-thing");
    expect((parsed as any).nested).toEqual({ a: 1 });
  });

  it("partial rows object gets merged with defaults", () => {
    const parsed = parseContentSpec(JSON.stringify({ rows: { enabled: true } }));
    expect(parsed?.rows).toEqual({ enabled: true, max: 5, columns: null, format: null });
  });

  describe("starterContentSpec", () => {
    it("round-trips through serialize -> parse", () => {
      const spec = starterContentSpec();
      const parsed = parseContentSpec(serializeContentSpec(spec));
      expect(parsed).toEqual(spec);
    });

    it("enables matching rows by default", () => {
      expect(starterContentSpec().rows.enabled).toBe(true);
    });

    it("only references known variables in title, body and fields", () => {
      const spec = starterContentSpec();
      const haystacks = [spec.title, spec.body, ...spec.fields.map((f) => f.value)];
      for (const haystack of haystacks) {
        const tokens = Array.from(haystack.matchAll(/\{([a-zA-Z0-9_]+)\}/g)).map((m) => m[1]);
        for (const token of tokens) {
          expect(KNOWN_VARIABLES).toContain(token);
        }
      }
    });

    it("has no links (the alert URL link is appended automatically)", () => {
      expect(starterContentSpec().links).toEqual([]);
    });
  });

  describe("hasOptionalContent", () => {
    it("is false for an empty spec", () => {
      expect(hasOptionalContent(emptyContentSpec())).toBe(false);
    });

    it("is true when fields are present", () => {
      const spec = emptyContentSpec();
      spec.fields = [{ label: "L", value: "V" }];
      expect(hasOptionalContent(spec)).toBe(true);
    });

    it("is true when links are present", () => {
      const spec = emptyContentSpec();
      spec.links = [{ label: "L", url: "U" }];
      expect(hasOptionalContent(spec)).toBe(true);
    });

    it("is true when rows are enabled", () => {
      const spec = emptyContentSpec();
      spec.rows.enabled = true;
      expect(hasOptionalContent(spec)).toBe(true);
    });

    it("is true when a title override is present", () => {
      const spec = emptyContentSpec();
      spec.title_overrides = { slack: "Custom" };
      expect(hasOptionalContent(spec)).toBe(true);
    });

    it("is true for the starter spec (rows enabled)", () => {
      expect(hasOptionalContent(starterContentSpec())).toBe(true);
    });
  });

  // Mirrors the backend allowlist in
  // src/config/src/meta/alerts/content_spec.rs — these cases are kept in sync
  // deliberately so the inline error and the API's 400 agree. The backend
  // remains the enforcing layer; this only moves the message next to the field.
  describe("linkUrlBadScheme", () => {
    it("rejects active-content schemes, including blocklist bypasses", () => {
      for (const hostile of [
        "javascript:alert(1)",
        "JavaScript:alert(1)",
        "  javascript:alert(1)",
        "java\tscript:alert(1)",
        "java\nscript:alert(1)",
        "\0javascript:alert(1)",
        "java%73cript:alert(1)",
        "vbscript:msgbox(1)",
        "file:///etc/passwd",
        "data:text/html,<script>1",
        // A variable elsewhere does not excuse a literal hostile scheme.
        "{x}javascript:alert(1)",
        // Trailing whitespace must not smuggle a scheme past the check.
        "javascript:alert(1)   ",
      ]) {
        expect(linkUrlBadScheme(hostile), `accepted: ${hostile}`).toBeTruthy();
      }
    });

    // A link field holds a URL. These cannot execute anything (no scheme), but
    // they are not links either — accepting them means the author finds out
    // the link is dead when an alert fires.
    it("rejects values that are not URLs at all", () => {
      for (const junk of [
        "javascript(0)",
        "not a url at all",
        "foo",
        "runbook.example.com/x", // bare host: ambiguous, require a scheme
        // An allowlisted scheme with NO HOST. Per the WHATWG URL Standard an
        // empty host is a parse FAILURE for a special scheme (http/https).
        "http:",
        "http://",
        "https://",
        "http:///",
        "http://?q=1",
        "http://#frag",
        // Hosts that parse but cannot resolve to anything real.
        "https://.",
        "http://..",
        "https://-",
        // `mailto:` needs a real mailbox; the parser accepts any opaque path.
        "mailto:",
        "mailto:foo",
        "mailto:@",
        "mailto:a@",
        "mailto:@b.com",
        "{x} not a url",
      ]) {
        expect(linkUrlBadScheme(junk), `accepted: ${junk}`).toBe(NOT_A_URL);
      }
    });

    it("accepts legitimate, templated and relative URLs", () => {
      for (const ok of [
        "https://runbook.example/x",
        "http://runbook.example/x",
        "mailto:oncall@example.com",
        "https://runbook.example/{stream_name}",
        "{alert_url}",
        "{alert_url}&tab=logs",
        "{scheme}://host/x", // variable IN scheme position
        "/web/logs?stream=app",
        "HTTPS://runbook.example/x", // schemes are case-insensitive
        "MAILTO:oncall@example.com",
        "  https://runbook.example/x  ", // surrounding whitespace is trimmed
        "https://o2.example:8443/web/logs?a=1#f",
        "http://localhost:5080/web/logs",
        "https://user:pass@host.example/x", // userinfo is legal
        "https://[::1]:8080/x", // IPv6 literal
        "https://192.168.1.1/x", // IPv4 literal
        // U+0085 (NEL) is Unicode White_Space, so Rust's `.trim()` strips it
        // and the backend accepts this. JS `.trim()` does NOT strip NEL, so
        // without an explicit class here the UI would flag a URL the API
        // saves happily — the frontend must not be stricter than the server.
        `${String.fromCharCode(0x85)}https://runbook.example/x`,
        "", // an empty row is not an error — it is simply not filled in yet
      ]) {
        expect(linkUrlBadScheme(ok), `rejected: ${ok}`).toBeNull();
      }
    });
  });
});
