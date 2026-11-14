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

import { computed, type ComputedRef } from "vue";

import config from "@/aws-exports";
import { useAssistantCapability } from "@/composables/assistant";

import {
  agentHomeState,
  askOffReason,
  type AgentHomeInput,
  type AgentHomeState,
  type AskOffReason,
} from "./homeState";

/** Home's state from the assistant gate, the credit mode and the edition. */
export function useAgentHomeState(): {
  state: ComputedRef<AgentHomeState>;
  offReason: ComputedRef<AskOffReason | null>;
} {
  const capability = useAssistantCapability();
  const input = computed<AgentHomeInput>(() => ({
    gate: capability.gate.value,
    creditMode: capability.value.creditMode ?? null,
    isEnterprise: config.isEnterprise === "true",
    isCloud: config.isCloud === "true",
  }));
  return {
    state: computed(() => agentHomeState(input.value)),
    offReason: computed(() => askOffReason(input.value)),
  };
}
