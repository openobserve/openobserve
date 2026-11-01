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

import { type CapabilityAgent } from "@/composables/assistant";
import { agentPolicy, agentPurpose, DEFAULT_AGENT } from "@/composables/assistant/pure";
import type { I18nText, TranslateFn } from "@/types/i18n";

/** "Finds causes · Read-only"; the default agent has no purpose line of its own. */
export function agentClause(agent: CapabilityAgent | undefined, t: TranslateFn): I18nText {
  const policy = agentPolicy(agent, t);
  if (!agent || agent.id === DEFAULT_AGENT) return policy;
  return t("assistant.agent.clause", { purpose: agentPurpose(agent.id, t), policy });
}
