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
//
// One place to answer "is this user-supplied string a URL we may navigate to?"
//
// This check had been written from scratch four times (`safeHttpUrl` in
// ingestion/setupCard/subs.ts, `getHttpUrl` in TableRenderer.vue, and twice in
// the synthetics schemas), and the two places that DIDN'T have it — dashboard
// drilldowns and stream cross-links — are exactly where unsafe values got in.
// Prefer this helper over a fifth hand-rolled regex.

/** Schemes that may ever be navigated to. NOT data:, file:, ws:, telnet:. */
const NAVIGABLE_SCHEMES = ["http:", "https:"];

export interface SafeUrlOptions {
  /** Also accept `mailto:` with a real `local@domain` mailbox. */
  allowMailto?: boolean;
  /**
   * Also accept a value whose scheme only materializes after `{variable}`
   * substitution at render time (alert templates, drilldowns, cross-links).
   * A literal hostile scheme is still rejected: `{x}javascript:` fails.
   */
  allowTemplateVars?: boolean;
}

/**
 * True when `value` is a URL that is safe to navigate to (`window.open`,
 * `location.href`, an `:href` binding).
 *
 * Why a parser and not a regex: a scheme allowlist alone is not enough —
 * `http:` and `https://` carry an allowlisted scheme and are still not URLs
 * (per the WHATWG URL Standard an empty host is a *parse failure* for a
 * special scheme). And a parser alone is not enough either — `javascript:`
 * parses perfectly well. Both checks are required, in that order.
 */
export function isSafeNavigableUrl(value: unknown, opts: SafeUrlOptions = {}): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;

  // Control characters and internal whitespace are never valid in a URL, and
  // are how `java\tscript:` style bypasses are smuggled past naive checks.
  for (const ch of trimmed) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x20 || c === 0x7f) return false;
  }

  if (opts.allowTemplateVars) {
    // A variable in SCHEME POSITION defers judgement to substitution time.
    // Deliberately strict: `{x}javascript:alert(1)` also starts with `{`, but
    // the rest of its scheme is the literal, hostile `javascript`, so the
    // variable must be the WHOLE scheme (or the whole value).
    const boundary = trimmed.search(/[:/?#]/);
    const schemeIsVariable =
      boundary === -1
        ? /^\{[^{}]+\}/.test(trimmed) // no scheme at all: `{alert_url}&tab=x`
        : trimmed[boundary] === ":" && /^\{[^{}]+\}$/.test(trimmed.slice(0, boundary));
    if (schemeIsVariable) return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  const scheme = parsed.protocol.toLowerCase();

  if (scheme === "mailto:") {
    if (!opts.allowMailto) return false;
    const at = parsed.pathname.indexOf("@");
    if (at <= 0) return false;
    const domain = parsed.pathname.slice(at + 1);
    return domain.includes(".") && !domain.startsWith(".");
  }

  if (!NAVIGABLE_SCHEMES.includes(scheme)) return false;

  // `new URL()` guarantees a non-empty host for a special scheme, but a host
  // may still be junk that can never resolve (".", "..", "-").
  const host = parsed.hostname;
  return host.length > 0 && /[a-z0-9]/i.test(host) && !/^[.-]/.test(host) && !/[.-]$/.test(host);
}

/**
 * True when `value` is safe to redirect to after login — a relative path, or
 * an absolute URL on `origin` itself.
 *
 * The previous check was `redirectURI.includes("http")`, a substring test that
 * accepted `https://evil.com/` and sent the user off-site immediately after
 * authenticating (the classic post-auth phishing setup).
 */
export function isSameOriginRedirect(
  value: string | null | undefined,
  origin: string = window.location.origin,
): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;

  for (const ch of trimmed) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x20 || c === 0x7f) return false;
  }

  // A backslash is normalized to `/` by browsers, so `/\evil.com` and
  // `\\evil.com` are protocol-relative in disguise.
  if (trimmed.includes("\\")) return false;
  // Protocol-relative (`//evil.com`) points off-origin despite looking relative.
  if (trimmed.startsWith("//")) return false;

  // Plain relative path: same origin by construction.
  if (trimmed.startsWith("/")) return true;

  try {
    return new URL(trimmed, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}
