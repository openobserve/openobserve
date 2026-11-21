<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <span
    :class="[AGENT_TEXT_CLASS, disabled ? 'text-text-body' : 'text-text-secondary']"
    data-test="assistant-agent-pill"
    :data-agent="agent"
    >{{ agentName(agent, t) }}</span
  >
</template>

<script lang="ts">
import type { AgentId } from "@/composables/assistant";

// OButton has no class merge, so the pill's fill and text must outrank the ghost variant's transparent ones.
export const AGENT_PICKER_CLASS =
  "bg-surface-subtle! text-text-heading! enabled:hover:bg-button-ghost-subtle-hover-bg! enabled:active:bg-button-ghost-subtle-active-bg! aria-expanded:bg-button-ghost-subtle-hover-bg! disabled:opacity-45";

export const AGENT_SHORT_CLASS = "inline-block max-w-[12ch] truncate align-bottom";

// Plain text and a chevron: the agent is a quiet setting, so it never outweighs the message.
export const AGENT_TRIGGER_CLASS =
  "text-text-secondary! enabled:hover:text-text-body! aria-expanded:text-text-body! bg-transparent! enabled:hover:bg-transparent! enabled:active:bg-transparent! ps-1.5! pe-1! gap-0.5! font-normal shrink-0";

const AGENT_TEXT_CLASS = "inline-flex h-7 shrink-0 items-center px-1.5 text-xs";

export interface AssistantAgentPillProps {
  agent: AgentId;
  /** Held under a decision: the box is tinted, where secondary text misses 4.5:1, so the name reads as body text. */
  disabled?: boolean;
}
</script>

<script setup lang="ts">
import { agentName } from "@/composables/assistant/pure";
import { useI18nTyped } from "@/types/i18n";

withDefaults(defineProps<AssistantAgentPillProps>(), { disabled: false });

const { t } = useI18nTyped();
</script>
