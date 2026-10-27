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

import {
  clearPrefill,
  writeFirstSource,
  type FirstSourceId,
} from "@/components/login/firstSourceOptions";
import { markHeardFromPending } from "@/components/login/heardFrom";
import billings from "@/services/billings";
import { connectDataPromptSessionKey } from "@/utils/slackCommunityInvite";
import type { InjectionKey } from "vue";

/** The page's Skip to app, provided to the footer every step renders. */
export const ONBOARDING_SKIP: InjectionKey<() => void> = Symbol("onboarding-skip");

const pendingStartKey = (email: string | undefined) =>
  `o2.onboarding.pendingStart.${email || "anonymous"}`;

/** Set on a first login; only a user with this marker records a start. */
export function markStartPending(email: string | undefined): void {
  try {
    window.localStorage.setItem(pendingStartKey(email), "true");
  } catch {
    // Without storage the start is not recorded; onboarding still works.
  }
}

/** True while a first login's start is still unrecorded, so the user came to onboarding from sign-up. */
export function startPending(email: string | undefined): boolean {
  try {
    return window.localStorage.getItem(pendingStartKey(email)) === "true";
  } catch {
    return false;
  }
}

// Login has already followed a redirectURI or marketplace link by now, so landing anywhere but Home means one was pending.
export function redirectPending(routeName: string | undefined): boolean {
  if (routeName !== "home") return true;
  try {
    const session = window.sessionStorage;
    if (session.getItem("redirectURI") || session.getItem("azure_marketplace_token")) return true;
  } catch {
    // Unreadable storage holds no pending redirect.
  }
  return document.cookie.split("; ").some((c) => c.startsWith("aws_marketplace_token="));
}

// Onboarding counts as this session's connect prompt, so the Slack invite waits for a later session.
export function suppressConnectPrompt(email: string | undefined): void {
  try {
    window.sessionStorage.setItem(connectDataPromptSessionKey(email ?? "anonymous"), "true");
  } catch {
    // Without storage the Slack invite may come a session early; routing goes ahead.
  }
}

/** Records the start of a first-login user; a failed call is silent, and the marker is put back for the next exit. */
export async function recordStart(
  org: string,
  email: string | undefined,
  firstSource: FirstSourceId | undefined,
  skipped: boolean,
): Promise<void> {
  if (firstSource) writeFirstSource(org, firstSource);
  const key = pendingStartKey(email);
  try {
    if (!window.localStorage.getItem(key)) return;
    // Taken before the request, so a double click sends once.
    window.localStorage.removeItem(key);
  } catch {
    return;
  }
  const restore = () => markStartPending(email);
  try {
    const res = await billings.submit_new_user_info(org, {
      from: "",
      company: "",
      first_source: firstSource,
      skipped,
    });
    if (res.status !== 200) return restore();
  } catch {
    return restore();
  }
  markHeardFromPending(email);
  clearPrefill();
}

const RECORD_WAIT_MS = 3000;

/** recordStart, but the caller waits at most 3 s; a slow request finishes in the background. */
export async function recordStartBounded(...args: Parameters<typeof recordStart>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    recordStart(...args),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, RECORD_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
}
