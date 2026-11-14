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

import type { OpenAssistantArgs } from "@/composables/assistant/pure";
import type { AlertRecord, PromptRange } from "@/utils/assistant/prompts";

type Payload = OpenAssistantArgs["payload"];

interface StoreShape {
  selectedOrganization?: { identifier?: string };
  timezone?: string;
}

/** One firing as an evaluation row knows it. */
export interface FiringSource {
  alert: AlertRecord;
  firedAt: number;
  observed?: number;
  window?: PromptRange;
}

function contextOf(state: StoreShape) {
  return {
    org: state.selectedOrganization?.identifier ?? "",
    timeZone: state.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

/** Explain / Troubleshoot this alert from a list row or a detail header; never a destination URL. */
export function alertBuild(
  alert: () => AlertRecord,
  verb: "explain" | "troubleshoot",
  state: StoreShape,
) {
  return async (): Promise<Payload> => {
    const prompts = await import("@/utils/assistant/prompts");
    return prompts.buildAlertPrompt(prompts.alertInputOf(alert(), contextOf(state)), verb);
  };
}

/** Troubleshoot / Add to chat on one firing: observed value against the threshold over the evaluated window. */
export function alertFiringBuild(firing: () => FiringSource, state: StoreShape) {
  return async (): Promise<Payload> => {
    const prompts = await import("@/utils/assistant/prompts");
    const f = firing();
    const input = prompts.alertInputOf(f.alert, contextOf(state));
    return prompts.buildAlertFiringPrompt({
      ...input,
      firedAt: f.firedAt,
      ...(typeof f.observed === "number" && {
        observed: { value: f.observed, unit: input.threshold?.unit },
      }),
      ...(f.window && { window: f.window }),
      ...(input.condition && { query: input.condition }),
    });
  };
}
