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
  domainRuleDefaults,
  makeDomainRuleSchema,
  ruleEmailKinds,
} from "./OrgDomainMapping.schema";

const schema = makeDomainRuleSchema((key) => key);
const errorsFor = (value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
};

describe("domain rule schema", () => {
  it("accepts allow-all with no emails", () => {
    expect(errorsFor(domainRuleDefaults("acme.com"))).toEqual([]);
  });

  it("needs at least one email to block listed users", () => {
    expect(errorsFor({ ...domainRuleDefaults("acme.com"), policy: "block_specific" })).toEqual([
      "blockedEmails:settings.orgDomainMapping.ruleBlockedRequired",
    ]);
  });

  it("rejects an email from another domain", () => {
    expect(
      errorsFor({
        ...domainRuleDefaults("acme.com"),
        policy: "allow_specific",
        allowedEmails: ["amy@other.com"],
      }),
    ).toEqual(["allowedEmails:settings.invalidEmail"]);
  });

  it("ignores the lists a policy does not keep", () => {
    expect(
      errorsFor({
        ...domainRuleDefaults("acme.com"),
        policy: "block_all",
        blockedEmails: ["x@y.z"],
      }),
    ).toEqual([]);
    expect(ruleEmailKinds("block_all")).toEqual([]);
    expect(ruleEmailKinds("allow_specific")).toEqual(["allowed"]);
  });
});
