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
  ALERT_LIBRARY_MANIFEST_URL,
  ALERT_LIBRARY_S3_PREFIX,
  SEVERITY_TO_PRIORITY,
  SUPPORTED_MANIFEST_MAJOR,
  alertFileUrl,
  priorityForSeverity,
} from "./alertLibrary";

// The alert library is served from S3 as a byte-for-byte mirror of
// github.com/openobserve/o2-alerts-library. Two GETs are the entire client
// surface — the manifest, then one alert file — so these builders are the only
// place the bucket is named. Hardcoding a URL at a call site is exactly how the
// dashboard gallery drifted (two paths, one stale, months apart).

describe("alert library URLs", () => {
  // NOTE: no "names the bucket in exactly one place" test. Asserting that both
  // URLs merely start with the base is satisfied by a module hardcoding two
  // full literals with the same host, so it constrains nothing the two
  // exact-string tests below don't already pin.

  it("points the manifest at the mirror root", () => {
    // Verified live: this exact URL serves format 1.0.0 with 87 alerts.
    expect(ALERT_LIBRARY_MANIFEST_URL).toBe(
      "https://openobserve-datasources-bucket.s3.amazonaws.com/alerts/manifest.json",
    );
  });

  it("resolves a manifest entry path against the mirror prefix", () => {
    // `path` in a manifest entry is REPO-relative ("packs/<pack>/alerts/…"),
    // and the repo is mirrored under the `alerts/` prefix — so the prefix must
    // be prepended. Verified live: this URL returns 200.
    expect(alertFileUrl("packs/k8s/alerts/pod/pod_oom_killed.json")).toBe(
      "https://openobserve-datasources-bucket.s3.amazonaws.com/alerts/packs/k8s/alerts/pod/pod_oom_killed.json",
    );
  });

  it("never produces a doubled slash, wherever it would come from", () => {
    // A doubled slash is a DIFFERENT S3 key and 404s. Three sources: a trailing
    // slash on the base, a leading slash on the path, and — the one a naive
    // split/encode/join misses entirely — an empty interior segment.
    const doubled = /[^:]\/\//;
    expect(alertFileUrl("packs/k8s/alerts/pod/pod_oom_killed.json")).not.toMatch(doubled);
    expect(alertFileUrl("/packs/k8s/alerts/pod/pod_oom_killed.json")).not.toMatch(doubled);
    expect(alertFileUrl("packs//alerts/pod.json")).not.toMatch(doubled);

    // A leading slash is stripped, not treated as a different resource.
    expect(alertFileUrl("/packs/k8s/alerts/pod/pod_oom_killed.json")).toBe(
      alertFileUrl("packs/k8s/alerts/pod/pod_oom_killed.json"),
    );
  });

  it("percent-encodes path segments but keeps the separators", () => {
    // Today's alert filenames are snake_case with no spaces, but pack and
    // category folders are contributor-authored: the sibling dashboards repo
    // already has folders like "AWS VPC Flow log". An unencoded space is an
    // invalid URL.
    expect(alertFileUrl("packs/k8s/alerts/app performance/go_gc.json")).toBe(
      "https://openobserve-datasources-bucket.s3.amazonaws.com/alerts/packs/k8s/alerts/app%20performance/go_gc.json",
    );
  });

  // NOTE: deliberately no "does not double-encode" case. Manifest paths are
  // emitted by CI from real filesystem paths and are never pre-encoded, so
  // requiring the builder to detect existing escapes would force
  // decode-then-encode (which throws on a malformed `%zz`) to defend a case
  // that cannot occur. Callers pass the manifest's `path` verbatim.

  it("refuses a path that escapes the library prefix", () => {
    // The manifest is fetched content. A traversal segment would let a bad or
    // tampered manifest point the client at an unrelated bucket key.
    expect(() => alertFileUrl("../../../etc/passwd.json")).toThrow();
    expect(() => alertFileUrl("packs/k8s/../../../secrets.json")).toThrow();
  });

  it("refuses an absolute URL as a path", () => {
    // Same reason: `path` is a relative key, never a destination the manifest
    // gets to choose.
    expect(() => alertFileUrl("https://example.com/evil.json")).toThrow();
    expect(() => alertFileUrl("//example.com/evil.json")).toThrow();
  });

  it("refuses an empty path", () => {
    expect(() => alertFileUrl("")).toThrow();
  });

  it("refuses a path that is not a string", () => {
    // A partial or hand-edited manifest entry can carry a missing `path`.
    // Failing loudly beats requesting `…/alerts/undefined` and reporting a 404
    // as if the alert were deleted upstream.
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(() => alertFileUrl(bad as unknown as string)).toThrow();
    }
  });

  it("exposes the prefix the mirror is served under", () => {
    expect(ALERT_LIBRARY_S3_PREFIX).toBe("alerts/");
  });
});

describe("manifest format version", () => {
  it("declares the major version this client understands", () => {
    // Settled: format evolution lives in a `format_version` field, not a URL
    // prefix (S3 mirrors GitHub exactly, so there is no /v1/ path to pick).
    // The client checks the major and refuses a shape it cannot read.
    expect(SUPPORTED_MANIFEST_MAJOR).toBe(1);
  });
});

describe("severity to AlertPriority mapping", () => {
  // Settled 2026-08-20. The library speaks critical|warning|info (3 values);
  // the product enum is P1..P5; the display vocabulary is
  // critical|high|medium|low|info. "warning" exists nowhere downstream, so this
  // table is the single translation point — never inline these numbers.

  it("maps the three library severities to the settled priorities", () => {
    // One exact assertion, deliberately: separate "keys are exactly these" and
    // "values are integers in 1..5" cases are both strictly implied by this and
    // cannot fail independently of it.
    //
    // The values are INTEGERS because the API stores priority as an id 1..=5.
    // Sending the string "P1" is a 400 that TypeScript will not catch for you;
    // "P1" exists only as a display label.
    expect(SEVERITY_TO_PRIORITY).toEqual({ critical: 1, warning: 3, info: 4 });
  });

  it("resolves a known severity through the helper", () => {
    expect(priorityForSeverity("critical")).toBe(1);
    expect(priorityForSeverity("warning")).toBe(3);
    expect(priorityForSeverity("info")).toBe(4);
  });

  it("returns null for an unknown severity instead of guessing", () => {
    // `priority` is Option<AlertPriority> — unset is a legitimate state.
    // Defaulting an unrecognised severity to a number would silently decide
    // what pages someone at 3am, which is the failure mode this whole pipeline
    // exists to prevent.
    expect(priorityForSeverity("catastrophic")).toBeNull();
    expect(priorityForSeverity("")).toBeNull();
    expect(priorityForSeverity(undefined as unknown as string)).toBeNull();
  });

  it("is case-sensitive and does not normalise", () => {
    // The manifest generator emits lowercase and fails the build otherwise, so
    // a capitalised value here means the data broke its contract — surface it
    // as unset rather than papering over it.
    expect(priorityForSeverity("Critical")).toBeNull();
  });

  it("returns null for inherited Object keys", () => {
    // `severity` arrives in a fetched document, so it is attacker- or
    // corruption-influenced input. A bare `TABLE[severity] ?? null` over an
    // object literal returns a FUNCTION for these — never reaching the `??` —
    // and that function would then be sent as an alert's priority.
    // Same threat model as the traversal cases above.
    for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"]) {
      expect(priorityForSeverity(key)).toBeNull();
    }
  });
});
