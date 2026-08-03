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

import type { BlockedReason } from "@/types/synthetics";

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
 */
export function classifyPreflightFailure(error: string | undefined | null): BlockedReason {
  const message = (error ?? "").toLowerCase();
  if (message.includes("incognito")) return "incognito";
  if (message.includes("already in progress")) return "in-progress";
  return "preflight";
}
