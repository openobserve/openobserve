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
    v-if="shown"
    class="flex min-w-0 items-center gap-1.5"
    data-test="assistant-agent-picker-root"
  >
    <template v-if="isMobile">
      <OButton
        v-bind="triggerAttrs"
        variant="ghost"
        size="xs"
        class="min-h-11"
        @click="sheetOpen = true"
      >
        <OIcon :name="agentGlyph[shownAgent]" size="xs" />
        {{ shownName }}
        <template #icon-right><OIcon :name="assistantGlyph.expand" size="xs" /></template>
      </OButton>
      <OSheet
        v-model:open="sheetOpen"
        v-model:snap="sheetSnap"
        :ariaLabel="String(t('assistant.agent.picker.heading'))"
        :expand-label="t('assistant.shell.sheetExpand')"
        :collapse-label="t('assistant.shell.sheetPeek')"
        data-test="assistant-agent-sheet"
        privacy="mask"
      >
        <template #header>
          <p class="text-text-heading px-4 text-sm font-medium">
            {{ t("assistant.agent.picker.heading") }}
          </p>
        </template>
        <div class="flex flex-col gap-1 p-2" role="radiogroup">
          <div v-for="row in rows" :key="row.id" class="flex flex-col">
            <OButton
              variant="ghost"
              size="sm"
              role="radio"
              :aria-checked="row.id === shownAgent"
              :aria-disabled="row.reason ? 'true' : undefined"
              class="h-auto! min-h-14 w-full justify-start! text-start"
              :data-test="`assistant-agent-option-${row.id}`"
              @click="choose(row)"
            >
              <AssistantMark
                size="md"
                class="size-8!"
                :glyph="row.reason ? assistantGlyph.locked : agentGlyph[row.id]"
              />
              <span class="flex min-w-0 flex-1 flex-col">
                <span :class="row.reason ? 'text-text-secondary' : 'text-text-heading'">{{
                  row.name
                }}</span>
                <span class="text-text-secondary text-xs whitespace-normal">{{
                  row.reason ?? row.purpose
                }}</span>
              </span>
              <template v-if="row.id === shownAgent" #icon-right>
                <OIcon :name="assistantGlyph.done" size="sm" />
              </template>
            </OButton>
            <AssistantAskAdminPopover
              v-if="row.askAdmin"
              kind="agent_access"
              :org="org"
              :agent="String(row.name)"
            >
              <template #trigger>
                <OButton
                  variant="ghost-primary"
                  size="xs"
                  class="min-h-11"
                  data-test="assistant-agent-ask-admin"
                >
                  {{ t("assistant.outcome.actions.askAdmin") }}
                </OButton>
              </template>
            </AssistantAskAdminPopover>
          </div>
        </div>
        <p class="text-text-secondary px-4 pb-3 text-xs">{{ t("assistant.agent.picker.note") }}</p>
      </OSheet>
    </template>
    <ODropdown
      v-else
      v-model:open="menuOpen"
      side="top"
      align="start"
      privacy="mask"
      content-class="w-[min(24rem,calc(100vw-1.5rem))]"
    >
      <template #trigger>
        <OButton
          v-bind="triggerAttrs"
          variant="ghost"
          size="xs"
          @keydown.up.prevent="menuOpen = true"
        >
          <OIcon :name="agentGlyph[shownAgent]" size="xs" />
          {{ shownName }}
          <template #icon-right><OIcon :name="assistantGlyph.expand" size="xs" /></template>
        </OButton>
      </template>
      <ODropdownGroup :label="t('assistant.agent.picker.heading')">
        <template v-for="row in rows" :key="row.id">
          <ODropdownItem
            role="menuitemradio"
            :aria-checked="row.id === shownAgent"
            :disabled="!!row.reason"
            focusable-unavailable
            :text-value="row.name"
            :description="row.reason"
            :data-test="`assistant-agent-option-${row.id}`"
            @select="choose(row)"
          >
            <template #icon-left>
              <AssistantMark
                size="sm"
                :glyph="row.reason ? assistantGlyph.locked : agentGlyph[row.id]"
              />
            </template>
            <span class="flex min-w-0 flex-col">
              <span
                :class="['text-sm font-medium', row.reason ? 'text-text-secondary' : '']"
                data-test="assistant-agent-option-name"
                >{{ row.name }}</span
              >
              <span v-if="!row.reason" class="text-text-secondary text-xs whitespace-normal">{{
                row.purpose
              }}</span>
              <span class="text-text-secondary text-xs">{{ row.policy }}</span>
            </span>
            <template v-if="row.id === shownAgent" #icon-right>
              <OIcon :name="assistantGlyph.done" size="sm" />
            </template>
          </ODropdownItem>
          <div v-if="row.askAdmin" class="px-3 pb-1">
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
      <ODropdownSeparator />
      <p class="text-text-secondary px-3 py-1.5 text-xs" data-test="assistant-agent-picker-note">
        {{ t("assistant.agent.picker.note") }}
      </p>
    </ODropdown>
    <OText v-if="nextName" variant="meta" class="truncate" data-test="assistant-agent-picker-next">
      {{ t("assistant.agent.picker.next", { agent: nextName }) }}
    </OText>
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useStore } from "vuex";

import AssistantMark from "@/components/ai-assistant/common/AssistantMark.vue";
import { agentGlyph, assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantAskAdminPopover from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import { announceComposer } from "@/components/ai-assistant/composer/composerUi";
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
  agentPolicy,
  agentPurpose,
  agentReason,
  currentAgent,
  nextAgent,
  rosterOffersChoice,
} from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OSheet from "@/lib/overlay/Sheet/OSheet.vue";
import type { SheetSnap } from "@/lib/overlay/Sheet/OSheet.types";
import { useI18nTyped, type I18nText } from "@/types/i18n";

interface Row {
  id: AgentId;
  name: I18nText;
  purpose: I18nText;
  policy: I18nText;
  reason: I18nText | null;
  askAdmin: boolean;
}

const props = defineProps<{ sid: Sid | null }>();

const { t } = useI18nTyped();
const store = useAssistantStore();
const vuex = useStore();
const capability = useAssistantCapability();
const placement = useAssistantPlacement();
const { mdUp } = useBreakpoint();
const isMobile = computed(() => !mdUp.value);
const menuOpen = ref(false);
const sheetOpen = ref(false);
const sheetSnap = ref<SheetSnap>("half");

const roster = computed(() => capability.value.agents);
const shown = computed(() => rosterOffersChoice(roster.value));
const session = computed(() => (props.sid ? (store.state.sessions[props.sid] ?? null) : null));
const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const shownAgent = computed(() => nextAgent(session.value));
const shownName = computed(() => agentName(shownAgent.value, t));
const nextName = computed(() => {
  const next = session.value?.nextAgentId;
  return next && next !== currentAgent(session.value) ? agentName(next, t) : null;
});
const triggerAttrs = computed(() => ({
  "aria-label": t("assistant.agent.picker.label", { agent: shownName.value }),
  "data-test": "assistant-agent-picker",
}));

const rows = computed<Row[]>(() =>
  (roster.value ?? []).map((agent) => {
    const refusal = store.agentRefusal(agent.id);
    return {
      id: agent.id,
      name: agentName(agent.id, t),
      purpose: agentPurpose(agent.id, t),
      policy: agentPolicy(agent, t),
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
  sheetOpen.value = false;
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
