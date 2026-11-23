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

// Which sentence a custom domain's view is shown with. The server decides the state, the reason
// and the warning; this only looks the sentence up and never derives one from DNS or dates.
import type { I18nKey } from "@/types/i18n";
import type { StatusPageDomain } from "@/services/status_pages";
import { formatTimestampInTimezone } from "@/utils/date";
import { shownServingState } from "./statusPageBadges";

export interface DomainText {
  key: I18nKey;
  named?: Record<string, string>;
}

// The record a row carries, read from the view alone: a CNAME target, a TXT name, or neither.
export type DomainRecordKind = "cname" | "txt" | null;

export function domainRecordKind(d: StatusPageDomain): DomainRecordKind {
  if (d.cname_target) return "cname";
  return d.txt_name ? "txt" : null;
}

// The message for each state and reason; any other pair shows no line.
const REASON_KEYS: Record<string, I18nKey> = {
  "pending:record_missing": "statusPages.domains.reason.recordMissing",
  "pending:value_mismatch": "statusPages.domains.reason.valueMismatch",
  "pending:dns_lookup_failed": "statusPages.domains.reason.dnsLookupFailed",
  "pending:no_record": "statusPages.domains.reason.noRecord",
  "pending:points_elsewhere": "statusPages.domains.reason.pointsElsewhere",
  "pending:points_at_app_host": "statusPages.domains.reason.pointsAtAppHost",
  "pending:proof_stale": "statusPages.domains.reason.proofStale",
  "waiting_for_dns:no_record": "statusPages.domains.reason.noRecord",
  "waiting_for_dns:points_elsewhere": "statusPages.domains.reason.pointsElsewhere",
  "waiting_for_dns:points_at_app_host": "statusPages.domains.reason.pointsAtAppHost",
  "verified:cloud_not_enabled": "statusPages.domains.reason.cloudNotEnabled",
  "verified:not_enabled": "statusPages.domains.reason.notEnabled",
  "verified:proxy_mode": "statusPages.domains.reason.proxyMode",
  "not_serving:org_blocked": "statusPages.domains.reason.orgBlocked",
  "not_serving:org_denied": "statusPages.domains.reason.orgDenied",
  "not_serving:org_not_allowed": "statusPages.domains.reason.orgNotAllowed",
  "not_serving:not_licensed": "statusPages.domains.reason.notLicensed",
  "not_serving:plan_required": "statusPages.domains.reason.planRequired",
  "not_serving:invalid_host": "statusPages.domains.reason.invalidHost",
  "not_serving:caa_blocks": "statusPages.domains.reason.caaBlocks",
  "not_serving:ca_dns": "statusPages.domains.reason.caDns",
  "not_serving:ca_caa": "statusPages.domains.reason.caCaa",
  "not_serving:ca_connection": "statusPages.domains.reason.caConnection",
  "not_serving:ca_tls_terminated": "statusPages.domains.reason.caTlsTerminated",
  "not_serving:ca_rate_limited": "statusPages.domains.reason.caRateLimited",
  "not_serving:ca_other": "statusPages.domains.reason.caOther",
};

// A claim that is not the holder and has no record to show is off: it is not verified.
const OFF_PENDING_REASONS = ["cloud_not_enabled", "not_enabled"];

// These name the record the row carries, so a CNAME row never reads TXT and a TXT row never CNAME.
const RECORD_REASON_KEYS: Record<string, Record<"cname" | "txt", I18nKey>> = {
  "pending:held_by_another_org": {
    cname: "statusPages.domains.reason.heldByAnotherOrgCname",
    txt: "statusPages.domains.reason.heldByAnotherOrg",
  },
  "pending:proof_lost": {
    cname: "statusPages.domains.reason.proofLostCname",
    txt: "statusPages.domains.reason.proofLost",
  },
};

const PROOF_LOST_SINCE_KEYS: Record<"cname" | "txt", I18nKey> = {
  cname: "statusPages.domains.reason.proofLostSinceCname",
  txt: "statusPages.domains.reason.proofLostSince",
};

// Rows 5 and 8 are always a fault on the operator's side: Cloud's team, or the administrator.
const FAULT_REASONS = ["certificate_mismatch", "probe_failed"];

// The reasons whose row says who must act, from `acts`, and when the next try is.
export function isActsReason(d: StatusPageDomain): boolean {
  if (d.serving_state !== "not_serving" || !d.reason) return false;
  return d.reason === "invalid_host" || d.reason === "caa_blocks" || d.reason.startsWith("ca_");
}

function settingUpText(d: StatusPageDomain, formatTime: (us: number) => string): DomainText {
  if (d.reason === "order_running") return { key: "statusPages.domains.reason.orderRunning" };
  if (d.reason === "queued" && d.next_action_at) {
    return {
      key: "statusPages.domains.reason.queued",
      named: { time: formatTime(d.next_action_at) },
    };
  }
  return { key: "statusPages.domains.reason.settingUp" };
}

function pendingReasonText(
  d: StatusPageDomain,
  formatTime: (us: number) => string,
): DomainText | null {
  const reason = d.reason ?? "";
  if (OFF_PENDING_REASONS.includes(reason)) {
    return d.expires_at
      ? {
          key: "statusPages.domains.reason.pendingOff",
          named: { date: formatTime(d.expires_at) },
        }
      : { key: "statusPages.domains.reason.pendingOffNoDate" };
  }
  const kind = domainRecordKind(d);
  const byRecord: Record<"cname" | "txt", I18nKey> | undefined =
    RECORD_REASON_KEYS[`pending:${reason}`];
  if (!byRecord || !kind) return null;
  const since = d.evidence?.proof_failed_since;
  if (reason === "proof_lost" && since) {
    return { key: PROOF_LOST_SINCE_KEYS[kind], named: { time: formatTime(since) } };
  }
  return { key: byRecord[kind] };
}

// The one reason line of a row; null when there is none to show.
export function domainMessage(
  d: StatusPageDomain,
  cloud: boolean,
  formatTime: (us: number) => string,
): DomainText | null {
  const state = shownServingState(d);
  switch (state) {
    case "ready":
      return { key: "statusPages.domains.reason.ready" };
    case "serving":
      return { key: "statusPages.domains.reason.serving" };
    case "delayed":
      return {
        key: cloud
          ? "statusPages.domains.reason.delayedCloud"
          : "statusPages.domains.reason.delayedSelfHosted",
      };
    case "setting_up":
      return settingUpText(d, formatTime);
    default:
  }
  const reason = d.reason ?? "";
  if (state === "not_serving" && FAULT_REASONS.includes(reason)) {
    return {
      key: cloud
        ? "statusPages.domains.reason.cannotServeCloud"
        : "statusPages.domains.reason.cannotServeSelfHosted",
    };
  }
  if (state === "pending") {
    const pending = pendingReasonText(d, formatTime);
    if (pending) return pending;
  }
  const key: I18nKey | undefined = REASON_KEYS[`${state}:${reason}`];
  if (!key) return null;
  return key === "statusPages.domains.reason.pointsAtAppHost"
    ? { key, named: { appHost: d.app_host ?? "", target: d.cname_target ?? "" } }
    : { key };
}

// Name the next step separately so an operator-side failure never asks for a customer change.
export function domainNextStep(d: StatusPageDomain, cloud: boolean): I18nKey | null {
  if (!isActsReason(d)) return null;
  if (d.acts === "operator") {
    return cloud
      ? "statusPages.domains.reason.actsOperatorCloud"
      : "statusPages.domains.reason.actsOperatorSelfHosted";
  }
  if (d.reason === "caa_blocks" || (d.reason === "ca_caa" && d.acts === "customer")) {
    return "statusPages.domains.reason.fixCaa";
  }
  return d.reason === "ca_dns" && d.acts === "customer"
    ? "statusPages.domains.reason.fixDns"
    : null;
}

const WARNINGS: { state: string; reason?: string; warning: string; key: I18nKey }[] = [
  {
    state: "verified",
    reason: "proxy_mode",
    warning: "txt_missing",
    key: "statusPages.domains.txtMissingWarning",
  },
  {
    state: "waiting_for_dns",
    warning: "cname_missing",
    key: "statusPages.domains.cnameMissingWarning",
  },
  {
    state: "serving",
    warning: "renewal_failing",
    key: "statusPages.domains.renewalFailingWarning",
  },
];

// The warning banner of a row, with the time the server gives; none without both.
export function domainWarning(
  d: StatusPageDomain,
  formatTime: (us: number) => string,
): DomainText | null {
  const state = shownServingState(d);
  const match = WARNINGS.find(
    (w) =>
      w.state === state &&
      w.warning === d.warning &&
      (w.reason === undefined || w.reason === d.reason),
  );
  if (!match || !d.warning_at) return null;
  return { key: match.key, named: { time: formatTime(d.warning_at) } };
}

// What was last proven about a serving domain; a serving row always has the first fact.
export function domainEvidence(
  d: StatusPageDomain,
  formatTime: (us: number) => string,
): DomainText[] {
  const e = d.evidence;
  if (shownServingState(d) !== "serving" || e?.probe_checked_at == null) return [];
  const checked = { time: formatTime(e.probe_checked_at) };
  if (e.probe_mode === "load_balancer") {
    return [{ key: "statusPages.domains.evidence.loadBalancer", named: checked }];
  }
  const lines: DomainText[] = [{ key: "statusPages.domains.evidence.listener", named: checked }];
  if (e.ca_validated_at) {
    lines.push({
      key: "statusPages.domains.evidence.listenerReachable",
      named: { time: formatTime(e.ca_validated_at) },
    });
  }
  return lines;
}

// 12 hours, in microseconds, as the state's age at which the row says it may be out of date.
const STALE_AFTER_US = 12 * 3600 * 1_000_000;

export function isStateStale(d: StatusPageDomain, nowMs: number): boolean {
  return d.state_computed_at != null && nowMs * 1000 - d.state_computed_at > STALE_AFTER_US;
}

// A time from the server, in microseconds, as the organization reads it.
export function formatDomainTime(us: number, timezone: string | undefined): string {
  return formatTimestampInTimezone(us, "YYYY-MM-DD HH:mm", timezone || "UTC");
}
