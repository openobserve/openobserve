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
  blockEmailsInConfig,
  configToBlocklists,
  setDomainBlocklist,
} from "./orgDomainRestrictions";

const apiConfig = {
  domains: [{ domain: "corp.io", allow_all_users: false, allowed_emails: ["a@corp.io"] }],
  enabled: false,
  blocked_emails: ["X@acme.com", "y@corp.io"],
  blocked_domains: ["spam.net"],
  updated_at: 5,
};

describe("orgDomainRestrictions", () => {
  it("returns no blocklists for a missing config", () => {
    expect(configToBlocklists(undefined)).toEqual([]);
  });

  it("groups blocked emails by domain and ignores the API-only rules", () => {
    expect(configToBlocklists(apiConfig)).toEqual([
      { name: "acme.com", blockedEmails: ["x@acme.com"] },
      { name: "corp.io", blockedEmails: ["y@corp.io"] },
    ]);
  });

  describe("setDomainBlocklist", () => {
    it("replaces one domain's emails and keeps allow rules and blocked domains", () => {
      const next = setDomainBlocklist(apiConfig, "Acme.com", ["bob@acme.com"], 1_000);
      expect(next).toEqual({
        domains: apiConfig.domains,
        enabled: true,
        blocked_emails: ["y@corp.io", "bob@acme.com"],
        blocked_domains: ["spam.net"],
        updated_at: 1_000_000,
      });
    });

    it("clears a domain's emails when given an empty list", () => {
      const next = setDomainBlocklist(apiConfig, "acme.com", []);
      expect(next.blocked_emails).toEqual(["y@corp.io"]);
    });
  });

  describe("blockEmailsInConfig", () => {
    it("adds a block without touching an allow list", () => {
      const next = blockEmailsInConfig(apiConfig, ["A@corp.io"], 1);
      expect(next.domains).toEqual(apiConfig.domains);
      expect(next.blocked_emails).toEqual(["X@acme.com", "y@corp.io", "a@corp.io"]);
      expect(next.blocked_domains).toEqual(["spam.net"]);
      expect(next.enabled).toBe(true);
      expect(next.updated_at).toBe(1000);
    });

    it("does not duplicate an email that is already blocked", () => {
      const next = blockEmailsInConfig({ blocked_emails: ["bob@acme.com"] }, ["BOB@acme.com"]);
      expect(next.blocked_emails).toEqual(["bob@acme.com"]);
    });
  });
});
