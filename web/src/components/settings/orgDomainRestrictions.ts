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

export interface DomainBlocklist {
  name: string;
  blockedEmails: string[];
}

export interface DomainManagementConfig {
  domains: { domain: string; allow_all_users: boolean; allowed_emails: string[] }[];
  enabled: boolean;
  blocked_emails: string[];
  blocked_domains: string[];
  updated_at: number;
}

const emailDomain = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

export function configToBlocklists(
  config: Partial<DomainManagementConfig> | undefined,
): DomainBlocklist[] {
  const byDomain = new Map<string, string[]>();
  for (const email of config?.blocked_emails ?? []) {
    const domain = emailDomain(email ?? "");
    if (!domain) continue;
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), email.toLowerCase()]);
  }
  return [...byDomain].map(([name, blockedEmails]) => ({ name, blockedEmails }));
}

export function setDomainBlocklist(
  config: Partial<DomainManagementConfig> | undefined,
  domain: string,
  emails: string[],
  now = Date.now(),
): DomainManagementConfig {
  const target = domain.toLowerCase();
  const others = (config?.blocked_emails ?? []).filter((e) => emailDomain(e) !== target);
  return withBlockedEmails(config, [...others, ...emails], now);
}

export function blockEmailsInConfig(
  config: Partial<DomainManagementConfig> | undefined,
  emails: string[],
  now = Date.now(),
): DomainManagementConfig {
  const blocked = [...(config?.blocked_emails ?? [])];
  for (const email of emails) {
    const target = email.toLowerCase();
    if (!blocked.some((e) => e.toLowerCase() === target)) blocked.push(target);
  }
  return withBlockedEmails(config, blocked, now);
}

// The UI edits only the blocklist; allow rules and blocked domains are API-only and pass through untouched.
function withBlockedEmails(
  config: Partial<DomainManagementConfig> | undefined,
  blocked: string[],
  now: number,
): DomainManagementConfig {
  return {
    domains: [...(config?.domains ?? [])],
    // The backend skips every block while restrictions are disabled.
    enabled: true,
    blocked_emails: blocked,
    blocked_domains: [...(config?.blocked_domains ?? [])],
    // The backend stores timestamps in microseconds.
    updated_at: now * 1000,
  };
}
