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

// The custom domains dialog no longer says a verified domain serves the page, so the strings
// that said so (and the numeric failure map that `serving_state` replaced) leave every locale.

import { describe, it, expect } from "vitest";
import { localeStems, readLocaleMessages } from "@/test/unit/helpers/localeFiles";

const REMOVED_DOMAIN_KEYS = ["serving", "nextStepCname", "deleteBody", "failureReason"];

interface DomainsMessages extends Record<string, unknown> {
  state: Record<string, string>;
}

const domainsOf = (stem: string) =>
  (readLocaleMessages(stem) as { statusPages: { domains: DomainsMessages } }).statusPages.domains;

describe("statusPages.domains in the locale files", () => {
  it("covers all 17 locales", () => {
    expect(localeStems()).toHaveLength(17);
  });

  describe.each(localeStems())("%s", (stem) => {
    it.each(REMOVED_DOMAIN_KEYS)("has no %s", (key) => {
      expect(Object.keys(domainsOf(stem))).not.toContain(key);
    });

    it("has no failed state label", () => {
      expect(Object.keys(domainsOf(stem).state)).not.toContain("failed");
    });
  });

  it("keeps a label for each of the nine states in en-US", () => {
    expect(Object.keys(domainsOf("en-US").state).sort()).toEqual([
      "delayed",
      "expired",
      "notServing",
      "pending",
      "ready",
      "serving",
      "settingUp",
      "verified",
      "waitingForDns",
    ]);
  });
});

// Every string value under statusPages.domains of en-US, with its dotted key path.
function leaves(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === "string") return [[path.join("."), node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, [...path, key]),
  );
}

// The keys that may name the TXT record: its labels and copy strings, and its reasons.
const TXT_KEYS = [
  "txtNameLabel",
  "txtValueLabel",
  "copyTxtName",
  "copyTxtValue",
  "txtNameCopied",
  "txtValueCopied",
  "recordInstructions",
  "txtMissingWarning",
  "reason.recordMissing",
  "reason.valueMismatch",
  "reason.heldByAnotherOrg",
  "reason.proofLost",
  "reason.proofLostSince",
  "installation.proxy",
];

// The keys that may say the word proxy: row 6a and the root's installation sentences.
const PROXY_KEYS = ["reason.proxyMode", "installation.proxy", "installation.off"];

describe("the words of statusPages.domains in en-US", () => {
  const all = leaves(domainsOf("en-US"));
  const textOf = (key: string) => all.find(([k]) => k === key)?.[1] ?? "";

  it("reads a non-empty set of strings", () => {
    expect(all.length).toBeGreaterThan(80);
  });

  it("never says a record is no longer there or must be put back", () => {
    expect(all.filter(([, text]) => /no longer|it back/i.test(text))).toEqual([]);
  });

  it("names the TXT record and _o2-verify only in the TXT keys", () => {
    const outside = all.filter(
      ([key, text]) => /TXT|_o2-verify/.test(text) && !TXT_KEYS.includes(key),
    );

    expect(outside).toEqual([]);
  });

  it.each(["reason.recordMissing", "reason.heldByAnotherOrg", "reason.proofLost"])(
    "keeps %s a TXT sentence",
    (key) => {
      expect(textOf(key)).toMatch(/TXT|_o2-verify/);
    },
  );

  it("never names a CNAME in a TXT key", () => {
    expect(TXT_KEYS.filter((key) => /CNAME/.test(textOf(key)))).toEqual([]);
  });

  it("says the whole word proxy only in row 6a and the installation sentences", () => {
    const outside = all.filter(
      ([key, text]) => /\bproxy\b/i.test(text) && !PROXY_KEYS.includes(key),
    );

    expect(outside).toEqual([]);
    expect(textOf("reason.pointsElsewhere")).toContain("CDN proxying");
  });
});
