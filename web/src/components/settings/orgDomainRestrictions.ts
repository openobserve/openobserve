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

export type RestrictionPolicy = "allow_all" | "allow_specific" | "block_specific" | "block_all";

export interface RestrictionCard {
  name: string;
  policy: RestrictionPolicy;
  allowedEmails: string[];
  blockedEmails: string[];
}

export interface DomainManagementConfig {
  domains: { domain: string; allow_all_users: boolean; allowed_emails: string[] }[];
  enabled: boolean;
  blocked_emails: string[];
  blocked_domains: string[];
  updated_at: number;
}

export const isAllowPolicy = (policy: RestrictionPolicy) =>
  policy === "allow_all" || policy === "allow_specific";

// A whole-domain block wins over an allow rule, matching the backend; blocked emails on an allowed domain keep its allow policy.
export function configToCards(
  config: Partial<DomainManagementConfig> | undefined,
): RestrictionCard[] {
  const byDomain = new Map<string, RestrictionCard>();
  const ensure = (name: string): RestrictionCard => {
    const key = name.toLowerCase();
    let card = byDomain.get(key);
    if (!card) {
      card = { name: key, policy: "allow_all", allowedEmails: [], blockedEmails: [] };
      byDomain.set(key, card);
    }
    return card;
  };

  for (const d of config?.domains ?? []) {
    if (!d?.domain) continue;
    const card = ensure(d.domain);
    card.policy = d.allow_all_users ? "allow_all" : "allow_specific";
    card.allowedEmails = [...(d.allowed_emails ?? [])];
  }
  const allowed = new Set(byDomain.keys());
  for (const email of config?.blocked_emails ?? []) {
    const domain = email?.split("@")[1]?.toLowerCase();
    if (!domain) continue;
    const card = ensure(domain);
    if (!allowed.has(domain)) card.policy = "block_specific";
    card.blockedEmails.push(email.toLowerCase());
  }
  for (const domain of config?.blocked_domains ?? []) {
    if (domain) ensure(domain).policy = "block_all";
  }
  return [...byDomain.values()];
}

export function cardsToConfig(cards: RestrictionCard[], now = Date.now()): DomainManagementConfig {
  return {
    domains: cards
      .filter((c) => isAllowPolicy(c.policy))
      .map((c) => ({
        domain: c.name,
        allow_all_users: c.policy === "allow_all",
        allowed_emails: c.policy === "allow_specific" ? c.allowedEmails : [],
      })),
    enabled: true,
    blocked_emails: cards.filter((c) => c.policy !== "block_all").flatMap((c) => c.blockedEmails),
    blocked_domains: cards.filter((c) => c.policy === "block_all").map((c) => c.name),
    // The backend stores timestamps in microseconds.
    updated_at: now * 1000,
  };
}

// An allow-specific domain is narrowed by dropping the email from its allow list; any other domain needs an explicit block.
export function blockEmailsInConfig(
  config: Partial<DomainManagementConfig> | undefined,
  emails: string[],
  now = Date.now(),
): DomainManagementConfig {
  let domains = (config?.domains ?? []).map((d) => ({ ...d }));
  const blocked = [...(config?.blocked_emails ?? [])];
  for (const email of emails) {
    const target = email.toLowerCase();
    const domain = target.split("@")[1] ?? "";
    let narrowed = false;
    domains = domains.map((d) => {
      if (d.domain?.toLowerCase() !== domain || d.allow_all_users) return d;
      narrowed = true;
      return {
        ...d,
        allowed_emails: (d.allowed_emails ?? []).filter((e) => e.toLowerCase() !== target),
      };
    });
    if (!narrowed && !blocked.some((e) => e.toLowerCase() === target)) blocked.push(target);
  }
  return {
    domains,
    enabled: true,
    blocked_emails: blocked,
    blocked_domains: [...(config?.blocked_domains ?? [])],
    updated_at: now * 1000,
  };
}

export function cardsSnapshot(cards: RestrictionCard[]): string {
  return JSON.stringify(
    cards
      .map((c) => ({
        name: c.name,
        policy: c.policy,
        allowedEmails: [...c.allowedEmails].sort(),
        blockedEmails: [...c.blockedEmails].sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}
