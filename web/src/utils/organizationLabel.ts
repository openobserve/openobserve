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

/**
 * Email domains that identify a person, not a company — appending them to a
 * disambiguated org label ("default (Gmail - John)") would be noise, not signal.
 */
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "live.com",
  "msn.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "gmx.com",
  "me.com",
]);

export interface OrgOwnerInfo {
  name: string;
  /** Owner's email domain, title-cased, omitted for generic consumer providers. */
  owner_email?: string;
  owner_first_name?: string;
}

const capitalizeDomainLabel = (domain: string): string => {
  const base = domain.split(".")[0];
  if (!base) return "";
  return base.charAt(0).toUpperCase() + base.slice(1);
};

const ownerNameOrEmailPrefix = (firstName?: string, email?: string): string => {
  if (firstName?.trim()) return firstName.trim();
  return email?.split("@")[0] ?? "";
};

/**
 * Builds the "Domain - Name" (or just "Name" for generic email providers)
 * suffix used to tell apart two orgs that share a display name, e.g. two
 * orgs both named "default" — one the user's own, one they were invited
 * into. Returns "" when there isn't enough owner info to disambiguate.
 */
export const buildOrgDisambiguator = (ownerEmail?: string, ownerFirstName?: string): string => {
  const name = ownerNameOrEmailPrefix(ownerFirstName, ownerEmail);
  if (!name) return "";

  const domain = ownerEmail?.split("@")[1]?.toLowerCase();
  if (domain && !GENERIC_EMAIL_DOMAINS.has(domain)) {
    const domainLabel = capitalizeDomainLabel(domain);
    if (domainLabel) return `${domainLabel} - ${name}`;
  }
  return name;
};

/**
 * Appends the owner disambiguator to an org's name, but only for orgs whose
 * name collides with another org's in the same list — a uniquely named org
 * (e.g. "payments-prod") is left untouched.
 *
 * Takes/returns `any[]`, not a generic: every call site maps over the raw
 * (loosely typed) `/organizations` API response, so a generic here would
 * just collapse to the `OrgOwnerInfo` constraint and lose the caller's own
 * field shape (id, identifier, UserObj, ...) instead of preserving it.
 */
export const withDisambiguatedOrgLabels = (orgs: (OrgOwnerInfo & Record<string, any>)[]): any[] => {
  const nameCounts = new Map<string, number>();
  for (const org of orgs) {
    nameCounts.set(org.name, (nameCounts.get(org.name) ?? 0) + 1);
  }

  return orgs.map((org) => {
    if ((nameCounts.get(org.name) ?? 0) <= 1) return { ...org, label: org.name };
    const disambiguator = buildOrgDisambiguator(org.owner_email, org.owner_first_name);
    return {
      ...org,
      label: disambiguator ? `${org.name} (${disambiguator})` : org.name,
    };
  });
};
