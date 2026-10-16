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
import { domainBlocklistDefaults, makeDomainBlocklistSchema } from "./OrgDomainMapping.schema";

const schema = makeDomainBlocklistSchema((key) => key);
const errorsFor = (value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
};

describe("domain blocklist schema", () => {
  it("accepts emails from the chosen domain", () => {
    expect(errorsFor({ domain: "acme.com", blockedEmails: ["bob@acme.com"] })).toEqual([]);
  });

  it("needs at least one email", () => {
    expect(errorsFor(domainBlocklistDefaults("acme.com"))).toEqual([
      "blockedEmails:settings.orgDomainMapping.ruleBlockedRequired",
    ]);
  });

  it("rejects an email from another domain", () => {
    expect(errorsFor({ domain: "acme.com", blockedEmails: ["amy@other.com"] })).toEqual([
      "blockedEmails:settings.invalidEmail",
    ]);
  });
});
