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
  blockStateOf,
  buildDomainRestrictionsBody,
  cardAfterRemoval,
  cardsToRestrictions,
  enablingAppliesDormantRules,
  parseDomainRestrictions,
  restrictionsToCards,
  withBlockedEmail,
  withoutBlockedEmail,
  type DomainRestrictions,
} from "./domainRestrictions";

const restrictions = (overrides: Partial<DomainRestrictions> = {}): DomainRestrictions => ({
  enabled: true,
  domains: [],
  blocked_emails: [],
  blocked_domains: [],
  ...overrides,
});

describe("parseDomainRestrictions", () => {
  it("keeps the flat lists and drops server-only fields", () => {
    const parsed = parseDomainRestrictions({
      enabled: true,
      updated_at: 5,
      domains: [
        {
          domain: "acme.com",
          allow_all_users: false,
          allowed_emails: ["a@acme.com"],
          enabled: true,
          created_at: 1,
          updated_at: 2,
        },
      ],
      blocked_emails: ["x@evil.com"],
      blocked_domains: ["evil.org"],
    });
    expect(parsed).toEqual({
      enabled: true,
      domains: [
        {
          domain: "acme.com",
          allow_all_users: false,
          allowed_emails: ["a@acme.com"],
          enabled: true,
        },
      ],
      blocked_emails: ["x@evil.com"],
      blocked_domains: ["evil.org"],
    });
  });

  it("keeps a rule that is switched off", () => {
    const parsed = parseDomainRestrictions({
      enabled: true,
      domains: [{ domain: "acme.com", allow_all_users: true, allowed_emails: [], enabled: false }],
    });
    expect(parsed.domains[0].enabled).toBe(false);
    expect(buildDomainRestrictionsBody(parsed).domains[0].enabled).toBe(false);
  });

  it("reads a missing or partial config as disabled and empty", () => {
    expect(parseDomainRestrictions(undefined)).toEqual(restrictions({ enabled: false }));
    expect(parseDomainRestrictions(JSON.parse('{"domains":null}'))).toEqual(
      restrictions({ enabled: false }),
    );
  });
});

describe("blockStateOf", () => {
  const config = restrictions({
    blocked_emails: ["Jane@Acme.com"],
    blocked_domains: ["EVIL.org"],
  });

  it("matches a blocked email in any case", () => {
    expect(blockStateOf("jane@acme.COM", config)).toBe("email");
  });

  it("matches the domain after the last @ in any case", () => {
    expect(blockStateOf("bob@evil.org", config)).toBe("domain");
    expect(blockStateOf("a@evil.org@acme.com", config)).toBe("none");
  });

  it("names the domain block when both apply, as unblocking the email would not unblock", () => {
    const both = restrictions({ blocked_emails: ["bob@evil.org"], blocked_domains: ["evil.org"] });
    expect(blockStateOf("bob@evil.org", both)).toBe("domain");
  });

  it("shows nobody blocked while the config is disabled", () => {
    const disabled = { ...config, enabled: false };
    expect(blockStateOf("jane@acme.com", disabled)).toBe("none");
    expect(blockStateOf("bob@evil.org", disabled)).toBe("none");
  });

  it("leaves everyone else unblocked", () => {
    expect(blockStateOf("someone@acme.com", config)).toBe("none");
  });
});

describe("withBlockedEmail / withoutBlockedEmail", () => {
  it("adds the lowercased email once", () => {
    const config = restrictions({ blocked_emails: ["a@x.com"] });
    expect(withBlockedEmail(config, "Jane@Acme.com").blocked_emails).toEqual([
      "a@x.com",
      "jane@acme.com",
    ]);
    expect(withBlockedEmail(config, "A@X.com").blocked_emails).toEqual(["a@x.com"]);
    expect(config.blocked_emails).toEqual(["a@x.com"]);
  });

  it("removes every spelling of the email and nothing else", () => {
    const config = restrictions({ blocked_emails: ["Jane@acme.com", "a@x.com", "jane@ACME.com"] });
    expect(withoutBlockedEmail(config, "jane@acme.com").blocked_emails).toEqual(["a@x.com"]);
    expect(config.blocked_emails).toHaveLength(3);
  });
});

describe("enablingAppliesDormantRules", () => {
  const allowList = [
    { domain: "acme.com", allow_all_users: true, allowed_emails: [], enabled: true },
  ];

  it("is true for a disabled config that holds any rule", () => {
    for (const dormant of [
      { domains: allowList },
      { blocked_domains: ["contractor.com"] },
      { blocked_emails: ["x@other.com"] },
    ]) {
      expect(enablingAppliesDormantRules(restrictions({ enabled: false, ...dormant }))).toBe(true);
    }
  });

  it("is false for an enabled config or an empty disabled one", () => {
    expect(enablingAppliesDormantRules(restrictions({ domains: allowList }))).toBe(false);
    expect(enablingAppliesDormantRules(restrictions({ enabled: false }))).toBe(false);
  });
});

const rule = (domain: string, allowAll: boolean, emails: string[] = [], enabled = true) => ({
  domain,
  allow_all_users: allowAll,
  allowed_emails: emails,
  enabled,
});

describe("restrictionsToCards / cardsToRestrictions", () => {
  it("shows one card per domain, block over allow", () => {
    const cards = restrictionsToCards(
      restrictions({
        domains: [rule("acme.com", true), rule("some.com", false, ["a@some.com"])],
        blocked_emails: ["Alice@acme.com"],
        blocked_domains: ["evil.org"],
      }),
    );
    expect(cards.map((c) => [c.name, c.policy, c.allowedEmails, c.blockedEmails])).toEqual([
      ["acme.com", "block_specific", [], ["alice@acme.com"]],
      ["some.com", "allow_specific", ["a@some.com"], []],
      ["evil.org", "block_all", [], []],
    ]);
  });

  const mixed = () =>
    restrictions({
      domains: [rule("acme.com", true), rule("other.com", true)],
      blocked_emails: ["alice@acme.com"],
    });

  it("keeps the allow rule of a domain whose users are also blocked", () => {
    const loaded = mixed();
    const saved = cardsToRestrictions(restrictionsToCards(loaded), loaded);
    expect(saved.domains).toEqual([rule("acme.com", true), rule("other.com", true)]);
    expect(saved.blocked_emails).toEqual(["alice@acme.com"]);
  });

  it("keeps that allow rule under either block policy", () => {
    const loaded = mixed();
    const cards = restrictionsToCards(loaded);
    cards[0].policy = "block_all";
    expect(cardsToRestrictions(cards, loaded)).toEqual({
      domains: [rule("acme.com", true), rule("other.com", true)],
      blocked_domains: ["acme.com"],
      blocked_emails: [],
    });
  });

  it("writes the visible rule once the operator picks an allow policy", () => {
    const loaded = mixed();
    const cards = restrictionsToCards(loaded);
    cards[0].policy = "allow_specific";
    cards[0].allowedEmails = ["bob@acme.com"];
    expect(cardsToRestrictions(cards, loaded).domains[0]).toEqual(
      rule("acme.com", false, ["bob@acme.com"]),
    );
  });

  it("drops an allow rule the operator could see once its card is removed", () => {
    const loaded = mixed();
    const cards = restrictionsToCards(loaded).filter((c) => c.name !== "other.com");
    expect(cardsToRestrictions(cards, loaded).domains).toEqual([rule("acme.com", true)]);
  });

  it("depends on the last saved state, not on what was loaded first", () => {
    const loaded = mixed();
    const cards = restrictionsToCards(loaded);
    cards[0].policy = "block_all";
    const saved = { ...cardsToRestrictions(cards, loaded), enabled: true };
    cards[0].policy = "block_specific";
    const fromSession = cardsToRestrictions(cards, saved);
    const reloaded = restrictionsToCards(saved);
    reloaded[0].policy = "block_specific";
    reloaded[0].blockedEmails = ["alice@acme.com"];
    expect(cardsToRestrictions(reloaded, saved)).toEqual(fromSession);
  });

  it("keeps a switched-off rule switched off", () => {
    const loaded = restrictions({ domains: [rule("acme.com", true, [], false)] });
    expect(cardsToRestrictions(restrictionsToCards(loaded), loaded).domains).toEqual([
      rule("acme.com", true, [], false),
    ]);
  });
});

describe("cardAfterRemoval", () => {
  it("turns a blocked card back into the allow rule it hid, so removing it unblocks", () => {
    const loaded = restrictions({
      domains: [rule("acme.com", false, ["bob@acme.com"])],
      blocked_emails: ["alice@acme.com"],
    });
    const [card] = restrictionsToCards(loaded);
    expect(cardAfterRemoval(card, loaded)).toEqual({
      name: "acme.com",
      policy: "allow_specific",
      allowedEmails: ["bob@acme.com"],
      blockedEmails: [],
    });
  });

  it("removes a card that hides no allow rule", () => {
    const loaded = restrictions({
      domains: [rule("other.com", true)],
      blocked_emails: ["alice@acme.com"],
    });
    for (const card of restrictionsToCards(loaded)) {
      expect(cardAfterRemoval(card, loaded)).toBeNull();
    }
  });
});

describe("buildDomainRestrictionsBody", () => {
  it("writes the flat lists with explicit keys and always enables the config", () => {
    const body = buildDomainRestrictionsBody(
      restrictions({
        enabled: false,
        domains: [
          {
            domain: "all.com",
            allow_all_users: true,
            allowed_emails: ["stale@all.com"],
            enabled: true,
          },
          {
            domain: "some.com",
            allow_all_users: false,
            allowed_emails: ["a@some.com"],
            enabled: true,
          },
        ],
        blocked_emails: ["x@evil.com"],
        blocked_domains: ["evil.org"],
      }),
    );
    expect(body).toEqual({
      domains: [
        { domain: "all.com", allow_all_users: true, allowed_emails: [], enabled: true },
        {
          domain: "some.com",
          allow_all_users: false,
          allowed_emails: ["a@some.com"],
          enabled: true,
        },
      ],
      blocked_domains: ["evil.org"],
      blocked_emails: ["x@evil.com"],
      enabled: true,
    });
  });
});
