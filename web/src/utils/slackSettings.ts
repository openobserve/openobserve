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

import type { SlackDisabledReason, SlackOrgConfig } from "@/types/slack";

export interface SlackOrgState {
  enabled: boolean;
  reason: SlackDisabledReason | null;
  homeRegion: string | null;
}

/** Disabled reasons a self-hosted enterprise admin can fix, so Settings › Slack explains them. */
export const SLACK_SCREEN_REASONS: readonly SlackDisabledReason[] = [
  "flag",
  "master_key",
  "home_region_unset",
  "other_region",
];

const DISABLED_VARIABLES: Partial<Record<SlackDisabledReason, string>> = {
  flag: "O2_SLACK_ENABLED",
  master_key: "O2_MASTER_ENCRYPTION_KEY",
  home_region_unset: "O2_SLACK_HOME_REGION",
};

// Never prefilled or accepted as a linking domain; the server refuses them too.
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
  "qq.com",
  "163.com",
]);

/** The Slack fields of the org config; a server that sends none is an OSS build. */
export function readSlackOrgConfig(zoConfig: SlackOrgConfig | null | undefined): SlackOrgState {
  const enabled = zoConfig?.slack_enabled === true;
  return {
    enabled,
    reason: enabled ? null : (zoConfig?.slack_disabled_reason ?? "edition"),
    homeRegion: zoConfig?.slack_home_region ?? null,
  };
}

/** Rail visibility of Settings › Slack: enabled orgs, plus self-hosted disabled screens. */
export function isSlackSettingsVisible(
  edition: { isEnterprise: boolean; isCloud: boolean },
  slack: SlackOrgState,
): boolean {
  if (!edition.isEnterprise && !edition.isCloud) return false;
  if (slack.enabled) return true;
  return (
    edition.isEnterprise &&
    !edition.isCloud &&
    slack.reason !== null &&
    SLACK_SCREEN_REASONS.includes(slack.reason)
  );
}

export function slackDisabledVariable(reason: SlackDisabledReason | null): string | null {
  return reason ? (DISABLED_VARIABLES[reason] ?? null) : null;
}

export function domainOfEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at > 0
    ? email
        .slice(at + 1)
        .trim()
        .toLowerCase()
    : "";
}

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/** Linking domains to prefill from the installer's email: their company domain, never a public one. */
export function installerDomainDefault(email: string): string[] {
  const domain = domainOfEmail(email);
  return domain && !isPublicEmailDomain(domain) ? [domain] : [];
}

export function firstPublicDomain(domains: readonly string[]): string | null {
  const hit = domains.find((d) => isPublicEmailDomain(d));
  return hit ? hit.trim().toLowerCase() : null;
}
