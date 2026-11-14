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
  <template v-if="shown">
    <ODropdown
      v-model:open="menuOpen"
      side="top"
      align="start"
      privacy="mask"
      :content-class="composerPopoverClass(layout.tight)"
    >
      <template #trigger>
        <OTag
          type="assistantContext"
          :label="agentName(current, t)"
          :icon="agentGlyph[current]"
          clickable
          :disabled="disabled"
          :class="['h-7 shrink-0 motion-safe:transition-colors', CHIP_HIT_AREA_CLASS]"
          data-test="assistant-launcher-agent"
          :data-agent="current"
        >
          {{ agentName(current, t) }}<OIcon :name="assistantGlyph.expand" size="xs" />
        </OTag>
      </template>
      <ODropdownGroup :label="t('assistant.agent.picker.heading')">
        <template v-if="sharedPolicy" #label-action>
          <span class="text-xs font-normal" data-test="assistant-launcher-agent-shared-policy">{{
            sharedPolicy
          }}</span>
        </template>
        <template v-for="row in rows" :key="row.id">
          <ODropdownItem
            role="menuitemradio"
            :aria-checked="row.id === current"
            :disabled="!!row.reason"
            focusable-unavailable
            :text-value="row.name"
            class="min-h-8"
            :data-test="`assistant-launcher-agent-option-${row.id}`"
            @select="choose(row)"
          >
            <template #icon-left>
              <OIcon
                :name="row.reason ? assistantGlyph.locked : agentGlyph[row.id]"
                size="xs"
                class="text-text-secondary"
              />
            </template>
            <span class="flex min-w-0 flex-1 flex-col items-start text-start">
              <span :class="['text-sm', row.reason ? 'text-text-secondary' : '']">{{
                row.name
              }}</span>
              <span
                v-if="row.askAdmin || row.reason"
                class="text-text-secondary min-w-0 text-xs"
                data-test="assistant-launcher-agent-option-clause"
                >{{ row.askAdmin ? t("assistant.agent.unavailable.short") : row.reason }}</span
              >
            </span>
            <template v-if="row.id === current" #icon-right>
              <OIcon
                :name="assistantGlyph.done"
                size="sm"
                class="text-assistant-link ms-auto"
                data-test="assistant-launcher-agent-option-checked"
              />
            </template>
          </ODropdownItem>
          <div v-if="row.askAdmin" class="flex justify-end px-3 pb-1">
            <AssistantAskAdminPopover kind="agent_access" :org="org" :agent="String(row.name)">
              <template #trigger>
                <OButton
                  variant="ghost-primary"
                  size="xs"
                  data-test="assistant-launcher-agent-ask-admin"
                >
                  {{ t("assistant.outcome.actions.askAdmin") }}
                </OButton>
              </template>
            </AssistantAskAdminPopover>
          </div>
        </template>
      </ODropdownGroup>
    </ODropdown>
    <OTooltip :content="t('assistant.welcome.launcher.agentHint')" />
  </template>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useStore } from "vuex";

import { sharedAgentPolicy } from "@/components/ai-assistant/agents/agentClause";
import { agentGlyph, assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  CHIP_HIT_AREA_CLASS,
  composerPopoverClass,
  useComposerLayout,
} from "@/components/ai-assistant/composer/composerUi";
import AssistantAskAdminPopover from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import {
  useAssistantCapability,
  useAssistantStore,
  type AgentId,
  type CapabilityAgent,
} from "@/composables/assistant";
import {
  agentName,
  agentReason,
  DEFAULT_AGENT,
  rosterOffersChoice,
} from "@/composables/assistant/pure";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

interface Row {
  id: AgentId;
  name: I18nText;
  reason: I18nText | null;
  askAdmin: boolean;
}

withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false });

/** The agent the line goes to; `null` is the default agent. */
const agent = defineModel<AgentId | null>({ default: null });

const { t } = useI18nTyped();
const store = useAssistantStore();
const vuex = useStore();
const capability = useAssistantCapability();
const layout = useComposerLayout();
const menuOpen = ref(false);

const roster = computed(() => capability.value.agents);
const shown = computed(() => rosterOffersChoice(roster.value));
const current = computed<AgentId>(() => agent.value ?? DEFAULT_AGENT);
const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const sharedPolicy = computed(() => sharedAgentPolicy(roster.value, t));

// The same rows as the chat's agent picker; Home has no chat yet, so a pick only waits for Send.
const rows = computed<Row[]>(() =>
  (roster.value ?? []).map((row) => {
    const refusal = store.agentRefusal(row.id);
    return {
      id: row.id,
      name: agentName(row.id, t),
      reason: agentReason(row, refusal, t),
      askAdmin: refusal ? refusal === "agent_not_permitted" : isRoleLocked(row),
    };
  }),
);

function isRoleLocked(row: CapabilityAgent): boolean {
  return !row.available && row.reason !== "unreachable" && row.reason !== "disabled";
}

function choose(row: Row): void {
  if (row.reason) return;
  agent.value = row.id === DEFAULT_AGENT ? null : row.id;
}

// The menu opens on the current agent, not on its first row, as the chat's picker does.
watch(menuOpen, (open) => {
  if (!open) return;
  void nextTick(() =>
    document
      .querySelector<HTMLElement>(`[data-test="assistant-launcher-agent-option-${current.value}"]`)
      ?.focus(),
  );
});
</script>
