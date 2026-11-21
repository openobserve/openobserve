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

/** What every secret-shaped value becomes in a prompt or a chip. */
export const REDACTED = "[redacted]";

// Keys whose value is a credential whatever it looks like; `authorization` also covers `proxy-authorization`.
const SECRET_KEY =
  /token|secret|passw(or)?d|pwd|authorization|api[-_]?key|cookie|credential|private[-_]?key/i;

// Each pattern keeps its label in group 1 and replaces only the value after it.
const SECRET_TEXT: readonly RegExp[] = [
  /(\bauthorization\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+(?:\s+[^\s,;]+)?)/gi,
  // A scheme word followed by prose ("Basic authentication failed") is not a credential: it needs a digit or symbol.
  /(\b(?:bearer|basic)\s+)(?=[a-z0-9._~+/=-]*[0-9._~+/=-])[a-z0-9._~+/=-]{8,}/gi,
  /(\b[a-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key)[a-z0-9_.-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;"']+)/gi,
  /()\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /()\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})/g,
  /()\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}/gi,
  /(:\/\/[^:/@\s]+:)[^@/\s]+(?=@)/g,
];

// A letters-only Basic credential still decodes to "user:pass", which prose after the word never does.
const BASIC_WORD = /(\bbasic\s+)([a-z0-9+/]{8,}={0,2})(?![a-z0-9+/=])/gi;

/** True for a key whose value is a credential by name: `*token*`, `*secret*`, `*password*`, `authorization`. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/** The text with every secret shape replaced by `[redacted]`: headers, bearer tokens, `password=`, AWS keys, JWTs, URL passwords. */
export function redactText(text: string): string {
  const shaped = SECRET_TEXT.reduce((out, pattern) => out.replace(pattern, `$1${REDACTED}`), text);
  return shaped.replace(BASIC_WORD, (whole, label: string, value: string) =>
    isBasicCredential(value) ? `${label}${REDACTED}` : whole,
  );
}

/** A deep copy with secret-named keys and secret-shaped strings redacted; nothing else changes. */
export function redactSecrets(value: unknown): unknown {
  return redactValue(value, new WeakSet());
}

/** A copy of a flat attribute map without the secret-named keys, for span attributes. */
export function withoutSecretKeys(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => !isSecretKey(key)));
}

// A count such as `input_tokens: 812` or a flag under a secret-like key carries no credential.
function isCredentialShaped(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  return typeof value !== "number" && typeof value !== "boolean";
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactText(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return REDACTED;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isSecretKey(key) && isCredentialShaped(item) ? REDACTED : redactValue(item, seen),
    ]),
  );
}

function isBasicCredential(value: string): boolean {
  try {
    return /^[\x20-\x7e]+:[\x20-\x7e]*$/.test(atob(value));
  } catch {
    return false;
  }
}
