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
import type { I18nText } from "@/types/i18n";
import type { DbmFinding } from "@/utils/assistant/prompts";

type Payload = OpenAssistantArgs["payload"];

interface StoreShape {
  selectedOrganization?: { identifier?: string };
}

/** The DBM fix door (`ai-entry-dbm-finding-fix`): a new thread "Database · {name}", the SQL in a chip. */
export function dbmFixDoor(
  copy: { label: I18nText; tooltip: I18nText },
  finding: () => DbmFinding,
  state: StoreShape,
  boundOrg?: string,
) {
  return {
    verb: "fix" as const,
    entryKind: "object_verb" as const,
    boundOrg,
    objectKind: "dbm_finding" as const,
    label: copy.label,
    tooltip: copy.tooltip,
    dataTest: "ai-entry-dbm-finding-fix" as const,
    build: async (): Promise<Payload> => {
      const f = finding();
      const name = f.input.dbInstance || f.input.dbSystem || "database";
      return (await import("@/utils/assistant/prompts")).buildDbmFindingPrompt({
        org: state.selectedOrganization?.identifier ?? "",
        name,
        finding: f,
      });
    },
  };
}
