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

import { watch } from "vue";

import { usePaidOverageConsent } from "@/composables/usePaidOverageConsent";

import type { AssistantState, CreditMode, Sid, TurnConsentRequest } from "./assistantStore.types";

export interface TurnConsentDeps {
  state(): AssistantState;
  /** Re-sends the waiting turn under its own id. */
  send(sid: Sid, turnId: string): unknown;
  /** A decline ends the waiting turn unsent with its prompt back. */
  stop(sid: Sid): unknown;
}

/** True where a turn can cost the org money, so cost lines and hints render. */
export function isMeteredCredit(mode: CreditMode | undefined): boolean {
  return mode === "consent_required" || mode === "pay_as_you_go";
}

/** The org's display name for consent copy; the identifier when the selected org is another. */
export function orgDisplayName(
  id: string,
  selected: { identifier?: unknown; label?: unknown } | null | undefined,
): string {
  return selected?.identifier === id && selected?.label ? String(selected.label) : id;
}

/** A turn's 412 goes through the one org-wide consent prompt; the turn resends or stops on the answer. */
export function createTurnConsent(deps: TurnConsentDeps) {
  const { promptForConsent } = usePaidOverageConsent();
  return (sid: Sid, { org, status, turnId }: TurnConsentRequest) => {
    const controller = new AbortController();
    // The prompt is withdrawn once the turn stops waiting on it (Stop, a new turn, a deleted chat).
    const stopWatching = watch(
      () => {
        const session = deps.state().sessions[sid];
        return session?.turn.state === "awaiting_consent" && session.turnMeta.turnId === turnId;
      },
      (waiting) => waiting || controller.abort(),
    );
    void promptForConsent(org, "ai_credits", status, controller.signal, "chat").then((accepted) => {
      stopWatching();
      if (controller.signal.aborted) return;
      if (accepted) deps.send(sid, turnId);
      else deps.stop(sid);
    });
  };
}
