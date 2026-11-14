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

import { isAssistantV2 } from "@/composables/assistant/flags";

/** Every sign-out asks the revamped assistant first: it cancels running answers, tells the other tabs and purges per-user data; "cancel" keeps the user signed in. */
export async function assistantSignOut(
  trigger: { invoker?: HTMLElement | null; forced?: boolean } = {},
): Promise<"proceed" | "cancel"> {
  if (!isAssistantV2()) return "proceed";
  // A chunk that fails to load (a tab left open across a deploy) or a throw must never keep the user signed in.
  try {
    const { assistantLifecycle } = await import("@/composables/assistant");
    return await assistantLifecycle.onSignOut(trigger);
  } catch {
    return "proceed";
  }
}
