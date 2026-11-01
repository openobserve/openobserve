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
  <ODropdownItem
    v-if="newChat"
    :icon-left="assistantGlyph.newChat"
    data-test="assistant-title-menu-new"
    @select="emit('new')"
  >
    {{ t("assistant.thread.newChat") }}
  </ODropdownItem>
  <template v-if="!actionsOnly">
    <ODropdownItem
      v-for="row in shown"
      :key="row.sid"
      :disabled="!!row.org"
      :focusable-unavailable="!!row.org"
      :aria-label="nameOf(row)"
      :data-status="row.status ?? undefined"
      data-test="assistant-title-menu-row"
      @select="emit('open', row.sid)"
    >
      <span class="flex min-w-0 flex-1 items-baseline gap-3">
        <span class="flex min-w-0 flex-1 flex-col">
          <OTruncatedText class="min-w-0 text-sm">{{ titleOf(row) }}</OTruncatedText>
          <OText v-if="row.org" as="span" variant="meta" data-test="assistant-title-menu-row-org">
            {{ orgName(row.org) }}
          </OText>
        </span>
        <span
          v-if="row.status"
          :class="[
            'group-data-[highlighted]/item:text-text-body shrink-0 text-xs tabular-nums',
            chatStatusClass(row.status, false),
          ]"
          data-test="assistant-title-menu-row-status"
          >{{ chatStatusWord(row.status, row.expiresAt, now, t) }}</span
        >
      </span>
    </ODropdownItem>
    <div v-if="failed" class="px-1 py-0.5" data-test="assistant-title-menu-error">
      <OBanner
        variant="error"
        dense
        role="presentation"
        :content="t('assistant.history.serverError')"
      >
        <template #actions>
          <OButton
            variant="ghost"
            size="xs"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-title-menu-retry"
            @click="history.retry()"
          >
            {{ t("common.retry") }}
          </OButton>
        </template>
      </OBanner>
    </div>
    <template v-else-if="loading">
      <div
        v-for="n in SKELETON_ROWS"
        :key="n"
        class="px-3 py-2"
        data-test="assistant-title-menu-skeleton"
      >
        <OSkeleton type="rect" class="h-4 w-3/5" />
      </div>
    </template>
    <OText
      v-else-if="!rows.length"
      as="p"
      variant="meta"
      class="px-3 py-2"
      data-test="assistant-title-menu-none"
    >
      {{ t("assistant.thread.noOtherChats") }}
    </OText>
    <ODropdownItem
      v-if="rows.length || loading || failed"
      data-test="assistant-title-menu-all"
      @select="emit('all')"
    >
      <span class="flex min-w-0 flex-1 items-baseline justify-between gap-3">
        <span class="text-assistant-link">{{ t("assistant.thread.allChats") }}</span>
        <OText
          v-if="rows.length > shown.length"
          as="span"
          variant="meta"
          data-test="assistant-title-menu-more"
        >
          {{ t("assistant.thread.moreChats", { count: rows.length - shown.length }) }}
        </OText>
      </span>
    </ODropdownItem>
  </template>
  <template v-if="$slots.default">
    <ODropdownSeparator v-if="!actionsOnly" />
    <slot />
  </template>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useStore } from "vuex";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  runAgentKey,
  useAssistantHistory,
  useAssistantName,
  useAssistantRuns,
  useAssistantStore,
  type Sid,
} from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import { chatStatusClass, chatStatusWord } from "../history/chatStatus";
import { TITLE_MENU_ROWS, titleMenuRows, type TitleMenuRow } from "./titleMenu";

const SKELETON_ROWS = 2;

const TICK_MS = 1_000;

const props = defineProps<{
  /** The chat this bar shows. */
  sid: Sid | null;
  /** New chat leads every window's menu, which has no `+`. */
  newChat?: boolean;
  /** The full view's rail is the list, so this menu keeps only the chat's actions. */
  actionsOnly?: boolean;
}>();

const emit = defineEmits<{ new: []; open: [sid: Sid]; all: [] }>();

defineSlots<{ default?: () => unknown }>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const store = useAssistantStore();
const history = useAssistantHistory();
const runs = useAssistantRuns();
const vuex = useStore();
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

const rows = computed(() =>
  titleMenuRows({
    runs: runs.rows.value,
    history: history.rows.value,
    drafts: history.drafts.value,
    turnOf: (sid) => store.state.sessions[sid]?.turn,
    current: props.sid,
  }),
);
const shown = computed(() => rows.value.slice(0, TITLE_MENU_ROWS));
const loading = computed(() => {
  const { status } = history.listState.value;
  return (status === "loading" || status === "idle") && shown.value.length < TITLE_MENU_ROWS;
});
const failed = computed(() => history.listState.value.status === "error");

function titleOf(row: TitleMenuRow): I18nText {
  return row.title ?? t("assistant.thread.newChatTitle");
}

function orgName(id: string): string {
  const orgs: { identifier: string; name?: string }[] = vuex.state.organizations ?? [];
  return orgs.find((org) => org.identifier === id)?.name ?? id;
}

// A title-menu row carries the agent in its accessible name only (§7).
function nameOf(row: TitleMenuRow): I18nText {
  const status = row.status ? chatStatusWord(row.status, row.expiresAt, now.value, t) : null;
  const parts = [String(titleOf(row)), status && String(status)];
  if (row.org) parts.push(orgName(row.org));
  if (row.agent)
    parts.push(String(t(`assistant.runs.agent.${runAgentKey(row.agent)}`, { product })));
  return raw(parts.filter(Boolean).join(", "));
}

onMounted(() => {
  history.ensureLoaded();
  timer = setInterval(() => (now.value = Date.now()), TICK_MS);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>
