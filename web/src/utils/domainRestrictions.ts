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

import type { DomainConfig, DomainManagementResponse } from "@/ts/interfaces";

/** The global SSO domain-management config of the meta org, as the UI reads and writes it. */
export interface DomainRestrictions {
  enabled: boolean;
  domains: DomainConfig[];
  blocked_emails: string[];
  blocked_domains: string[];
}

export interface DomainRestrictionsBody {
  domains: DomainConfig[];
  blocked_domains: string[];
  blocked_emails: string[];
  enabled: true;
}

export type DomainPolicy = "allow_all" | "allow_specific" | "block_specific" | "block_all";

/** One domain as the SSO management page edits it. */
export interface DomainCard {
  name: string;
  policy: DomainPolicy;
  allowedEmails: string[];
  blockedEmails: string[];
}

export type BlockState = "email" | "domain" | "none";
/** What a page shows; `unknown` when the config could not be read. */
export type ShownBlockState = BlockState | "unknown";

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** Defensive: an older server or a hand-edited row may leave fields missing or mistyped. */
export const parseDomainRestrictions = (
  data: Partial<DomainManagementResponse> | null | undefined,
): DomainRestrictions => ({
  enabled: data?.enabled === true,
  domains: (Array.isArray(data?.domains) ? data.domains : [])
    .filter((d) => d && typeof d.domain === "string")
    .map((d) => ({
      domain: d.domain,
      allow_all_users: d.allow_all_users !== false,
      allowed_emails: strings(d.allowed_emails),
      enabled: d.enabled !== false,
    })),
  blocked_emails: strings(data?.blocked_emails),
  blocked_domains: strings(data?.blocked_domains),
});

/** The PUT body of `domain_management`; every write enables the config, as the server defaults. */
export const buildDomainRestrictionsBody = (
  restrictions: Omit<DomainRestrictions, "enabled">,
): DomainRestrictionsBody => ({
  domains: restrictions.domains.map((rule) => ({
    domain: rule.domain,
    allow_all_users: rule.allow_all_users,
    allowed_emails: rule.allow_all_users ? [] : [...rule.allowed_emails],
    enabled: rule.enabled,
  })),
  blocked_domains: [...restrictions.blocked_domains],
  blocked_emails: [...restrictions.blocked_emails],
  enabled: true,
});

/** A domain block wins: removing the email entry would not let a domain-blocked user in. */
export const blockStateOf = (email: string, restrictions: DomainRestrictions): BlockState => {
  if (!restrictions.enabled) return "none";
  const lowered = email.toLowerCase();
  // The server takes the domain after the last @, so `a@evil.org@acme.com` is an acme.com user.
  const domain = lowered.includes("@") ? lowered.slice(lowered.lastIndexOf("@") + 1) : "";
  if (domain && restrictions.blocked_domains.some((d) => d.toLowerCase() === domain)) {
    return "domain";
  }
  return restrictions.blocked_emails.some((e) => e.toLowerCase() === lowered) ? "email" : "none";
};

export const withBlockedEmail = (
  restrictions: DomainRestrictions,
  email: string,
): DomainRestrictions => {
  const lowered = email.toLowerCase();
  const listed = restrictions.blocked_emails.some((e) => e.toLowerCase() === lowered);
  return {
    ...restrictions,
    blocked_emails: listed
      ? restrictions.blocked_emails
      : [...restrictions.blocked_emails, lowered],
  };
};

export const withoutBlockedEmail = (
  restrictions: DomainRestrictions,
  email: string,
): DomainRestrictions => {
  const lowered = email.toLowerCase();
  return {
    ...restrictions,
    blocked_emails: restrictions.blocked_emails.filter((e) => e.toLowerCase() !== lowered),
  };
};

/** Writing enables the config, which would start applying every rule it holds while switched off. */
export const enablingAppliesDormantRules = (restrictions: DomainRestrictions): boolean =>
  !restrictions.enabled &&
  (restrictions.domains.length > 0 ||
    restrictions.blocked_domains.length > 0 ||
    restrictions.blocked_emails.length > 0);

const isAllowPolicy = (policy: DomainPolicy) =>
  policy === "allow_all" || policy === "allow_specific";

const domainOfBlockedEmail = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

const savedRuleFor = (saved: DomainRestrictions, domain: string): DomainConfig | undefined =>
  saved.domains.find((rule) => rule.domain.toLowerCase() === domain.toLowerCase());

/** The saved allow rule of a domain whose card shows a block policy, so the card cannot show it. */
const hiddenAllowRule = (saved: DomainRestrictions, domain: string): DomainConfig | null => {
  const rule = savedRuleFor(saved, domain);
  if (!rule) return null;
  const key = domain.toLowerCase();
  const blocked =
    saved.blocked_domains.some((d) => d.toLowerCase() === key) ||
    saved.blocked_emails.some((e) => e.includes("@") && domainOfBlockedEmail(e) === key);
  return blocked ? rule : null;
};

/** One card per domain; a domain in several lists shows block_all over block_specific over allow. */
export const restrictionsToCards = (restrictions: DomainRestrictions): DomainCard[] => {
  const byDomain = new Map<string, DomainCard>();
  const ensure = (name: string): DomainCard => {
    const key = name.toLowerCase();
    let card = byDomain.get(key);
    if (!card) {
      card = { name, policy: "allow_all", allowedEmails: [], blockedEmails: [] };
      byDomain.set(key, card);
    }
    return card;
  };
  for (const rule of restrictions.domains.filter((d) => d.domain)) {
    const card = ensure(rule.domain);
    card.policy = rule.allow_all_users ? "allow_all" : "allow_specific";
    card.allowedEmails = [...rule.allowed_emails];
  }
  for (const email of restrictions.blocked_emails.filter((e) => e.includes("@"))) {
    const card = ensure(email.split("@")[1]);
    card.policy = "block_specific";
    card.blockedEmails.push(email.toLowerCase());
  }
  for (const domain of restrictions.blocked_domains.filter(Boolean)) {
    ensure(domain).policy = "block_all";
  }
  return [...byDomain.values()];
};

/** `saved` is the server's config as last loaded or saved; it holds the rules a block card hides. */
export const cardsToRestrictions = (
  cards: DomainCard[],
  saved: DomainRestrictions,
): Omit<DomainRestrictions, "enabled"> => ({
  domains: cards.flatMap((card): DomainConfig[] => {
    if (!isAllowPolicy(card.policy)) {
      const hidden = hiddenAllowRule(saved, card.name);
      return hidden ? [hidden] : [];
    }
    return [
      {
        domain: card.name,
        allow_all_users: card.policy === "allow_all",
        allowed_emails: card.policy === "allow_specific" ? card.allowedEmails : [],
        enabled: savedRuleFor(saved, card.name)?.enabled ?? true,
      },
    ];
  }),
  blocked_domains: cards.filter((c) => c.policy === "block_all").map((c) => c.name),
  blocked_emails: cards
    .filter((c) => c.policy === "block_specific")
    .flatMap((c) => c.blockedEmails),
});

/** Removing a block card that hides an allow rule lifts the block and shows the rule again. */
export const cardAfterRemoval = (
  card: DomainCard,
  saved: DomainRestrictions,
): DomainCard | null => {
  const hidden = isAllowPolicy(card.policy) ? null : hiddenAllowRule(saved, card.name);
  if (!hidden) return null;
  return {
    name: card.name,
    policy: hidden.allow_all_users ? "allow_all" : "allow_specific",
    allowedEmails: [...hidden.allowed_emails],
    blockedEmails: [],
  };
};
