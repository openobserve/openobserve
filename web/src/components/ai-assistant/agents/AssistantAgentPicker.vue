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
  <span v-if="shown" class="flex shrink-0 items-center" data-test="assistant-agent-picker-root">
    <ODropdown
      v-model:open="menuOpen"
      side="top"
      align="end"
      privacy="mask"
      :content-class="composerPopoverClass(layout.tight)"
    >
      <template #trigger>
        <AssistantIconButton
          :label="name"
          :icon="agentGlyph[shownAgent]"
          chevron
          :no-tooltip="menuOpen"
          :data-pending="pending ? '' : undefined"
          :class="pending ? 'bg-surface-accent-hover ring-border-focus ring-1' : ''"
          data-test="assistant-agent-picker"
          @keydown.up.prevent="menuOpen = true"
        >
          <template #tooltip>{{ tooltip }}</template>
        </AssistantIconButton>
      </template>
      <ODropdownGroup :label="t('assistant.agent.picker.heading')">
        <template v-for="row in rows" :key="row.id">
          <ODropdownItem
            role="option"
            :aria-selected="row.id === shownAgent"
            :disabled="!!row.reason"
            focusable-unavailable
            :text-value="row.name"
            :class="['min-h-8', row.id === shownAgent ? 'bg-dropdown-item-hover-bg' : '']"
            :data-test="`assistant-agent-option-${row.id}`"
            @select="choose(row)"
          >
            <template #icon-left>
              <OIcon
                :name="row.reason ? assistantGlyph.locked : agentGlyph[row.id]"
                size="xs"
                class="text-text-secondary"
              />
            </template>
            <span class="flex min-w-0 items-center gap-2">
              <span
                :class="['shrink-0 text-sm', row.reason ? 'text-text-secondary' : '']"
                data-test="assistant-agent-option-name"
                >{{ row.name }}</span
              >
              <span class="text-text-secondary ms-auto min-w-0 text-end text-xs">{{
                row.askAdmin ? t("assistant.agent.unavailable.short") : (row.reason ?? row.clause)
              }}</span>
            </span>
          </ODropdownItem>
          <div v-if="row.askAdmin" class="flex justify-end px-3 pb-1">
            <AssistantAskAdminPopover kind="agent_access" :org="org" :agent="String(row.name)">
              <template #trigger>
                <OButton variant="ghost-primary" size="xs" data-test="assistant-agent-ask-admin">
                  {{ t("assistant.outcome.actions.askAdmin") }}
                </OButton>
              </template>
            </AssistantAskAdminPopover>
          </div>
        </template>
      </ODropdownGroup>
    </ODropdown>
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useStore } from "vuex";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { agentGlyph, assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantAskAdminPopover from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import {
  announceComposer,
  composerPopoverClass,
  useComposerLayout,
} from "@/components/ai-assistant/composer/composerUi";
import {
  useAssistantCapability,
  useAssistantPlacement,
  useAssistantStore,
  type AgentId,
  type CapabilityAgent,
  type Sid,
} from "@/composables/assistant";
import {
  agentName,
  agentReason,
  currentAgent,
  nextAgent,
  rosterOffersChoice,
} from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

import { agentClause } from "./agentClause";

interface Row {
  id: AgentId;
  name: I18nText;
  clause: I18nText;
  reason: I18nText | null;
  askAdmin: boolean;
}

const props = defineProps<{ sid: Sid | null }>();

const { t } = useI18nTyped();
const store = useAssistantStore();
const vuex = useStore();
const capability = useAssistantCapability();
const placement = useAssistantPlacement();
const layout = useComposerLayout();
const menuOpen = ref(false);

const roster = computed(() => capability.value.agents);
const shown = computed(() => rosterOffersChoice(roster.value));
const session = computed(() => (props.sid ? (store.state.sessions[props.sid] ?? null) : null));
const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const shownAgent = computed(() => nextAgent(session.value));
const shownName = computed(() => agentName(shownAgent.value, t));
const pending = computed(() => {
  const next = session.value?.nextAgentId;
  return !!next && next !== currentAgent(session.value);
});
const shownClause = computed(() =>
  agentClause(
    roster.value?.find((agent) => agent.id === shownAgent.value),
    t,
  ),
);
const name = computed(() =>
  t("assistant.agent.picker.label", { agent: shownName.value, clause: shownClause.value }),
);
const tooltip = computed(() =>
  t("assistant.agent.picker.tooltip", { agent: shownName.value, clause: shownClause.value }),
);

const rows = computed<Row[]>(() =>
  (roster.value ?? []).map((agent) => {
    const refusal = store.agentRefusal(agent.id);
    return {
      id: agent.id,
      name: agentName(agent.id, t),
      clause: agentClause(agent, t),
      reason: agentReason(agent, refusal, t),
      askAdmin: refusal ? refusal === "agent_not_permitted" : isRoleLocked(agent),
    };
  }),
);

function isRoleLocked(agent: CapabilityAgent): boolean {
  return !agent.available && agent.reason !== "unreachable" && agent.reason !== "disabled";
}

// The composer creates the chat on first input; a pick before any text does the same.
function ensureSid(): Sid | null {
  if (props.sid) return props.sid;
  if (!store.state.ready) return null;
  return store.createSession({
    origin: {
      entryKind: "empty_state",
      objectKind: "none",
      container: placement.container.value ?? "sidebar",
    },
  });
}

function choose(row: Row): void {
  if (row.reason) return announce(row.reason);
  const sid = ensureSid();
  if (!sid) return;
  store.pickAgent(sid, row.id, "picker");
  announceComposer(sid, t("assistant.agent.announceChosen", { agent: row.name }));
}

function announce(line: I18nText): void {
  if (props.sid) announceComposer(props.sid, line);
}

// The menu opens on the current agent, not on its first row (MULTI-AGENT-01 AC 1).
watch(menuOpen, (open) => {
  if (!open) return;
  void nextTick(() =>
    document
      .querySelector<HTMLElement>(`[data-test="assistant-agent-option-${shownAgent.value}"]`)
      ?.focus(),
  );
});
</script>
