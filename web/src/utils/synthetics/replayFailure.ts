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

import type { BlockedReason, RestoreFailureReason, StructuredError } from "@/types/synthetics";

/**
 * Why a replay never reached step 1, read from the extension's own message.
 *
 * The UI used to infer "incognito" from the SHAPE of the failure alone — no
 * success, no step results — and discarded `ReplayResponse.error`. So every
 * pre-flight failure rendered the chrome://extensions walkthrough: a replay
 * still running from last time, a step whose action could not be built, a
 * window that failed to prepare. The most common trigger was a manually added
 * step with an empty locator, which has nothing to do with Chrome at all.
 *
 * Issue 004 specified "returns `{ success: false }` with an incognito-RELATED
 * error"; only the shape half was implemented. This is the other half.
 *
 * Matching on the message text is sound because the extension owns both ends:
 * `background.ts` answers a blocked window with "Recording needs incognito
 * access. …" and a busy player with "A replay is already in progress". Anything
 * unrecognised is `preflight`, which shows the real message rather than
 * claiming a cause it cannot support.
 *
 * ORDER MATTERS. playwright-crx rejects a second concurrent session with
 * "incognito crxApplication is already started" — a slot that is still held, not
 * a missing permission. That string contains the word "incognito", so the generic
 * test below used to claim it and render the chrome://extensions walkthrough:
 * the author was told to switch on a setting that was already on, and Retry threw
 * the same error forever. Both "already …" forms mean the same thing to the
 * author — wait for the running session, or reload the extension — which is
 * exactly what the `in-progress` card says.
 */
export function classifyPreflightFailure(error: string | undefined | null): BlockedReason {
  const message = (error ?? "").toLowerCase();
  if (message.includes("already in progress") || message.includes("already started"))
    return "in-progress";
  if (message.includes("incognito")) return "incognito";
  return "preflight";
}

/**
 * Why a restore stopped — a step that genuinely failed, or the author ending it.
 *
 * The recorder window is the only exit a restore offers today, so closing it is
 * how authors cancel. The extension sees that close as `runActions` rejecting
 * with a `TargetClosedError`, which it reports through the same `prefixFailed`
 * channel a real step failure uses. Rendered without this distinction, walking
 * away from a restore produces "step 9 failed" against a step that never ran —
 * and a warning banner nobody can act on, because there is nothing to fix.
 *
 * A newer extension names the reason itself and that word wins: it watched the
 * window go away rather than inferring it from an exception. The two fallbacks
 * are for extensions that predate the field, which O2 always runs against
 * (Web Store updates land asynchronously). `structuredError.name` is checked
 * before the message because it is the extension's own class; the message is
 * checked as well because a minified build can rename that class, and matching
 * the text is sound for the reason `classifyPreflightFailure` gives — the
 * extension owns both ends of the string.
 */
export function classifyRestoreFailure(failure: {
  reason?: RestoreFailureReason;
  error?: string;
  structuredError?: StructuredError;
}): RestoreFailureReason {
  if (failure.reason) return failure.reason;
  if (failure.structuredError?.name === "TargetClosedError") return "window-closed";
  // The full sentence, not a loose "closed": a journey that closes a tab of its own
  // produces messages with that word in them and is a genuine step failure.
  if ((failure.error ?? "").toLowerCase().includes("browser has been closed"))
    return "window-closed";
  return "step-failed";
}
