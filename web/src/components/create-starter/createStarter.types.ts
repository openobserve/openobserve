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

import type { I18nText } from "@/types/i18n";

export type ChoiceAvailability = "on" | "locked" | "hidden";

export interface StarterPane {
  id: "ai" | "library";
  label: I18nText;
  /** "44 match your data"; 0 = none match (no count shown); null = loading or failed. */
  count: number | null;
  availability: ChoiceAvailability;
  /** Why a locked choice cannot be picked; shown on hover and focus. */
  lockedReason?: I18nText;
}

/** Library scope; "all" = every service. Dimension names come from service_streams identity config, never hard-coded. */
export type StarterScope =
  | { kind: "all" }
  | { kind: "service"; service: string; dimensions: Record<string, string> }
  | { kind: "stream"; streamType: "logs" | "metrics" | "traces"; streamName: string };
