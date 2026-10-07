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
  cardsSnapshot,
  cardsToConfig,
  configToCards,
} from "./orgDomainRestrictions";

describe("orgDomainRestrictions", () => {
  it("returns no cards for a missing config", () => {
    expect(configToCards(undefined)).toEqual([]);
  });

  it("splits the flat config into one card per domain", () => {
    const cards = configToCards({
      domains: [
        { domain: "Acme.com", allow_all_users: true, allowed_emails: [] },
        { domain: "corp.io", allow_all_users: false, allowed_emails: ["a@corp.io"] },
      ],
      blocked_emails: ["X@evil.com"],
      blocked_domains: ["spam.net"],
    });
    expect(cards).toEqual([
      { name: "acme.com", policy: "allow_all", allowedEmails: [], blockedEmails: [] },
      {
        name: "corp.io",
        policy: "allow_specific",
        allowedEmails: ["a@corp.io"],
        blockedEmails: [],
      },
      {
        name: "evil.com",
        policy: "block_specific",
        allowedEmails: [],
        blockedEmails: ["x@evil.com"],
      },
      { name: "spam.net", policy: "block_all", allowedEmails: [], blockedEmails: [] },
    ]);
  });

  it("lets a whole-domain block win over an allow rule for the same domain", () => {
    const cards = configToCards({
      domains: [{ domain: "acme.com", allow_all_users: true, allowed_emails: [] }],
      blocked_domains: ["acme.com"],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].policy).toBe("block_all");
  });

  it("builds an enabled config with microsecond timestamp from the cards", () => {
    const config = cardsToConfig(
      [
        {
          name: "acme.com",
          policy: "allow_all",
          allowedEmails: ["stale@acme.com"],
          blockedEmails: [],
        },
        {
          name: "corp.io",
          policy: "allow_specific",
          allowedEmails: ["a@corp.io"],
          blockedEmails: [],
        },
        {
          name: "evil.com",
          policy: "block_specific",
          allowedEmails: [],
          blockedEmails: ["x@evil.com"],
        },
        { name: "spam.net", policy: "block_all", allowedEmails: [], blockedEmails: [] },
      ],
      1_000,
    );
    expect(config).toEqual({
      domains: [
        { domain: "acme.com", allow_all_users: true, allowed_emails: [] },
        { domain: "corp.io", allow_all_users: false, allowed_emails: ["a@corp.io"] },
      ],
      enabled: true,
      blocked_emails: ["x@evil.com"],
      blocked_domains: ["spam.net"],
      updated_at: 1_000_000,
    });
  });

  it("round-trips cards through the backend shape", () => {
    const cards = configToCards({
      domains: [{ domain: "corp.io", allow_all_users: false, allowed_emails: ["a@corp.io"] }],
      blocked_emails: ["x@evil.com"],
      blocked_domains: ["spam.net"],
    });
    expect(configToCards(cardsToConfig(cards))).toEqual(cards);
  });

  it("produces the same snapshot regardless of card and email order", () => {
    const a = [
      {
        name: "b.io",
        policy: "allow_specific" as const,
        allowedEmails: ["y@b.io", "x@b.io"],
        blockedEmails: [],
      },
      { name: "a.io", policy: "allow_all" as const, allowedEmails: [], blockedEmails: [] },
    ];
    const b = [
      { name: "a.io", policy: "allow_all" as const, allowedEmails: [], blockedEmails: [] },
      {
        name: "b.io",
        policy: "allow_specific" as const,
        allowedEmails: ["x@b.io", "y@b.io"],
        blockedEmails: [],
      },
    ];
    expect(cardsSnapshot(a)).toBe(cardsSnapshot(b));
  });
  it("keeps the allow policy when an allowed domain also has blocked emails", () => {
    const config = {
      domains: [
        { domain: "acme.com", allow_all_users: true, allowed_emails: [] },
        { domain: "corp.io", allow_all_users: false, allowed_emails: ["a@corp.io"] },
      ],
      blocked_emails: ["Bob@acme.com", "c@corp.io"],
      blocked_domains: [],
    };
    const cards = configToCards(config);
    expect(cards).toEqual([
      { name: "acme.com", policy: "allow_all", allowedEmails: [], blockedEmails: ["bob@acme.com"] },
      {
        name: "corp.io",
        policy: "allow_specific",
        allowedEmails: ["a@corp.io"],
        blockedEmails: ["c@corp.io"],
      },
    ]);
    const next = cardsToConfig(cards);
    expect(next.domains).toEqual(config.domains);
    expect(next.blocked_emails).toEqual(["bob@acme.com", "c@corp.io"]);
  });

  it("round-trips an allow-specific domain with no allowed emails", () => {
    const config = {
      domains: [{ domain: "corp.io", allow_all_users: false, allowed_emails: [] }],
    };
    const next = cardsToConfig(configToCards(config));
    expect(next.domains).toEqual(config.domains);
  });

  it("drops blocked emails from a whole-domain block", () => {
    const next = cardsToConfig([
      { name: "spam.net", policy: "block_all", allowedEmails: [], blockedEmails: ["x@spam.net"] },
    ]);
    expect(next.blocked_emails).toEqual([]);
    expect(next.blocked_domains).toEqual(["spam.net"]);
  });

  describe("blockEmailsInConfig", () => {
    it("drops the email from an allow-specific domain instead of adding a block", () => {
      const next = blockEmailsInConfig(
        {
          domains: [
            {
              domain: "corp.io",
              allow_all_users: false,
              allowed_emails: ["A@corp.io", "b@corp.io"],
            },
          ],
          blocked_emails: [],
          blocked_domains: [],
        },
        ["a@CORP.io"],
        1,
      );
      expect(next.domains[0].allowed_emails).toEqual(["b@corp.io"]);
      expect(next.blocked_emails).toEqual([]);
      expect(next.enabled).toBe(true);
      expect(next.updated_at).toBe(1000);
    });

    it("adds a block for an allow-all domain and keeps the allow entry", () => {
      const next = blockEmailsInConfig(
        {
          domains: [{ domain: "acme.com", allow_all_users: true, allowed_emails: [] }],
          blocked_emails: ["x@evil.com"],
          blocked_domains: ["spam.net"],
        },
        ["Bob@Acme.com"],
      );
      expect(next.domains).toEqual([
        { domain: "acme.com", allow_all_users: true, allowed_emails: [] },
      ]);
      expect(next.blocked_emails).toEqual(["x@evil.com", "bob@acme.com"]);
      expect(next.blocked_domains).toEqual(["spam.net"]);
    });

    it("applies every email in one pass across policies", () => {
      const next = blockEmailsInConfig(
        {
          domains: [
            {
              domain: "corp.io",
              allow_all_users: false,
              allowed_emails: ["a@corp.io", "b@corp.io"],
            },
            { domain: "acme.com", allow_all_users: true, allowed_emails: [] },
          ],
        },
        ["a@corp.io", "b@corp.io", "bob@acme.com"],
      );
      expect(next.domains[0].allowed_emails).toEqual([]);
      expect(next.blocked_emails).toEqual(["bob@acme.com"]);
    });

    it("does not duplicate an email that is already blocked", () => {
      const next = blockEmailsInConfig({ blocked_emails: ["bob@acme.com"] }, ["BOB@acme.com"]);
      expect(next.blocked_emails).toEqual(["bob@acme.com"]);
    });
  });
});
