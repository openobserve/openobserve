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

import { isSafeNavigableUrl } from "@/utils/safeUrl";

/** How a section 7.3 refusal reads on the link pages. */
export type SlackLinkRefusalKind =
  "expired" | "unknown" | "noAccess" | "wrongAccount" | "rateLimited" | "failed";

export interface SlackLinkRefusal {
  kind: SlackLinkRefusalKind;
  /** The server's own sentence for a 403 (it names the team and the Slack user). */
  message: string | null;
  /** The installation's help contact, sent as the 403 body's `hint`. */
  helpContact: string | null;
}

export interface SlackLinkRequestRef {
  requestId: string;
  sig: string;
}

export interface RememberedLinkRequest {
  r: string;
  helpContact: string | null;
}

/** `error_detail` values a 403 from the link endpoints carries. */
export const SLACK_LINK_NO_ACCESS = "no_access";
export const SLACK_LINK_WRONG_ACCOUNT = "wrong_account";

const STORAGE_KEY = "o2.slack.linkRequest";

/** A link request lives 30 minutes on the server, so a kept copy is useless after that. */
export const LINK_REQUEST_TTL_MS = 30 * 60 * 1000;

const SLACK_DOMAIN = "slack.com";

interface ErrorBody {
  message?: unknown;
  error_detail?: unknown;
  hint?: unknown;
}

const nonEmpty = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const responseOf = (error: unknown): { status?: number; data?: ErrorBody } | undefined => {
  if (!error || typeof error !== "object") return undefined;
  return (error as { response?: { status?: number; data?: ErrorBody } }).response;
};

/** The server's own sentence from an O2 error body, if it sent one. */
export function serverMessageOf(error: unknown): string | null {
  return nonEmpty(responseOf(error)?.data?.message);
}

/** HTTP status of an axios error, or undefined for a network failure. */
export function statusOf(error: unknown): number | undefined {
  return responseOf(error)?.status;
}

/** Maps a link-endpoint error to its page state; `forbidden` is the reading of a 403 without `error_detail`. */
export function classifySlackLinkError(
  error: unknown,
  forbidden: "noAccess" | "wrongAccount",
): SlackLinkRefusal {
  const response = responseOf(error);
  const data = response?.data ?? {};
  const helpContact = nonEmpty(data.hint);
  switch (response?.status) {
    case 400:
    case 410:
      return { kind: "expired", message: null, helpContact };
    case 404:
      return { kind: "unknown", message: null, helpContact };
    case 403: {
      const detail = data.error_detail;
      const kind =
        detail === SLACK_LINK_WRONG_ACCOUNT
          ? "wrongAccount"
          : detail === SLACK_LINK_NO_ACCESS
            ? "noAccess"
            : forbidden;
      return { kind, message: nonEmpty(data.message), helpContact };
    }
    case 429:
      return { kind: "rateLimited", message: null, helpContact };
    default:
      return { kind: "failed", message: null, helpContact };
  }
}

/** One value of a route query (`?a=x&a=y` reads as `x`). */
export function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
}

/** Splits `?r=<id>.<sig>`; the signature may itself contain dots. */
export function parseLinkRequestParam(value: unknown): SlackLinkRequestRef | null {
  const r = queryString(value).trim();
  const dot = r.indexOf(".");
  if (dot <= 0 || dot === r.length - 1) return null;
  return { requestId: r.slice(0, dot), sig: r.slice(dot + 1) };
}

/** Kept in localStorage because the 401 handler clears sessionStorage before the login round trip. */
export function rememberLinkRequest(r: string, helpContact: string | null): void {
  try {
    const expires_at = Date.now() + LINK_REQUEST_TTL_MS;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ r, helpContact, expires_at }));
  } catch {
    /* storage blocked: the callback page then offers no Try again */
  }
}

export function recallLinkRequest(): RememberedLinkRequest | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const { r, helpContact, expires_at } = parsed as Record<string, unknown>;
    if (typeof expires_at !== "number" || expires_at <= Date.now()) {
      forgetLinkRequest();
      return null;
    }
    if (!parseLinkRequestParam(r)) return null;
    return { r: r as string, helpContact: nonEmpty(helpContact) };
  } catch {
    return null;
  }
}

export function forgetLinkRequest(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: nothing was kept */
  }
}

const parseUrl = (value: unknown): URL | null => {
  if (!isSafeNavigableUrl(value)) return null;
  try {
    return new URL((value as string).trim());
  } catch {
    return null;
  }
};

/** An https URL on slack.com or one of its subdomains, or exactly on `host` when given. */
export function isSlackUrl(value: unknown, host?: string): boolean {
  const url = parseUrl(value);
  if (!url || url.protocol !== "https:" || url.port || url.username || url.password) return false;
  const name = url.hostname.toLowerCase();
  if (host) return name === host;
  return name === SLACK_DOMAIN || name.endsWith(`.${SLACK_DOMAIN}`);
}

/** Where a finished link may send the browser: back to Slack, or to a page of this OpenObserve. */
export function isSafeReturnUrl(value: unknown): boolean {
  if (isSlackUrl(value)) return true;
  return parseUrl(value)?.origin === window.location.origin;
}

/** Full-page hand-off to Slack; a module function so specs can stub the navigation. */
export function leaveFor(url: string): void {
  window.location.assign(url);
}
