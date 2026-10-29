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
  <section
    v-if="shown"
    :aria-labelledby="titleId"
    class="w-full min-w-0"
    data-test="assistant-launcher"
    data-assistant-surface
    data-dd-privacy="mask"
    :data-state="state"
  >
    <OCard variant="outlined" class="flex min-w-0 flex-col gap-3 p-4 max-md:p-3">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <AssistantMark size="sm" />
        <h2 :id="titleId" class="text-text-heading text-sm font-semibold">
          {{ t("assistant.name") }}
        </h2>
        <OTag
          v-if="creditsExhausted"
          :label="t('assistant.credits.exhaustedTag')"
          clickable
          data-test="assistant-launcher-credits"
          @click="openBilling"
        />
        <span class="flex-1" />
        <OButton
          variant="ghost"
          size="sm"
          :icon-right="assistantGlyph.goTo"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-launcher-open"
          @click="openFull"
        >
          {{ t("assistant.welcome.launcher.openFull") }}
        </OButton>
      </div>

      <AssistantGateState
        v-if="state === 'gate'"
        reason="no_permission"
        size="inline"
        :is-admin="capability.isAdmin"
        :context="{ org, feature: 'chat' }"
      />
      <template v-else>
        <div class="flex min-w-0 items-center gap-2">
          <OInput
            ref="input"
            v-model="text"
            size="md"
            width="full"
            :disabled="state === 'loading'"
            :placeholder="t('assistant.welcome.launcher.placeholder')"
            :input-attrs="{
              'aria-label': t('assistant.welcome.launcher.inputName', { product }),
              'aria-describedby': disclosureId,
              maxlength: MAX_LAUNCHER_CHARS,
              enterkeyhint: 'send',
            }"
            class="min-w-0 flex-1"
            data-test="assistant-launcher-input"
            @keydown="onKeydown"
          >
            <template #icon-left>
              <OIcon :name="assistantGlyph.assistant" size="sm" class="text-text-secondary" />
            </template>
          </OInput>
          <AssistantIconButton
            v-if="text"
            :label="t('assistant.welcome.launcher.clear')"
            :icon="assistantGlyph.close"
            data-test="assistant-launcher-clear"
            @click="clear"
          />
          <OButton
            variant="primary"
            size="sm-action"
            :icon-left="mdUp ? undefined : assistantGlyph.send"
            :disabled="state === 'loading'"
            class="shrink-0 max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11"
            data-test="assistant-launcher-ask"
            @click="ask(false)"
          >
            <span :class="mdUp ? '' : 'sr-only'">{{ t("assistant.welcome.launcher.ask") }}</span>
            <OShortcut v-if="mdUp" keys="enter" size="sm" class="ms-1" aria-hidden="true" />
          </OButton>
        </div>

        <div class="flex min-w-0 flex-wrap items-center gap-x-1">
          <OText :id="disclosureId" variant="meta" as="p" data-test="assistant-launcher-disclosure">
            {{ disclosure }}
          </OText>
          <OText variant="meta" as="span" aria-hidden="true">·</OText>
          <AssistantContextSeesPopover :sid="null" align="start" icon-only>
            <template #trigger>
              <OButton
                variant="ghost-primary"
                size="sm"
                class="max-md:min-h-11 pointer-coarse:min-h-11"
                data-test="assistant-launcher-sees"
                >{{ t("assistant.welcome.launcher.whatItSees") }}</OButton
              >
            </template>
          </AssistantContextSeesPopover>
        </div>
      </template>

      <div
        :class="['grid min-w-0 grid-cols-1 gap-x-6 gap-y-3', showSuggestions && 'md:grid-cols-2']"
      >
        <div
          v-if="showSuggestions"
          class="flex min-w-0 flex-col gap-2"
          data-test="assistant-launcher-suggestions"
        >
          <h3 class="text-text-secondary text-xs font-medium">
            {{ t("assistant.welcome.suggestions") }}
          </h3>
          <ul
            v-if="state === 'loading'"
            class="flex flex-col gap-2"
            data-test="assistant-launcher-loading"
          >
            <li v-for="n in 3" :key="n"><OSkeleton type="text" class="h-8 w-full" /></li>
          </ul>
          <ul v-else class="flex flex-col gap-2">
            <li v-for="(starter, index) in shownStarters" :key="starter.id" class="min-w-0">
              <OButton
                variant="secondary"
                size="sm"
                block
                class="h-auto! min-h-8 justify-start! py-1.5 text-start whitespace-normal! max-md:min-h-11 pointer-coarse:min-h-11"
                :data-test="`assistant-launcher-starter-${index}`"
                @click="pickStarter(starter, index)"
              >
                {{ starter.label }}
              </OButton>
            </li>
          </ul>
        </div>
        <!-- A chat that answers or waits outranks suggestions on a phone (PO A21). -->
        <div
          :class="['flex min-w-0 flex-col gap-2', hasInProgress && 'max-md:order-first']"
          data-test="assistant-launcher-your-chats"
        >
          <div class="flex min-w-0 items-center gap-2">
            <h3 class="text-text-secondary min-w-0 flex-1 text-xs font-medium">
              {{ t("assistant.welcome.launcher.yourChats") }}
            </h3>
            <OButton
              v-if="recent.length"
              variant="ghost-primary"
              size="sm"
              class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
              data-test="assistant-launcher-all-chats"
              @click="openFull"
              >{{ t("assistant.welcome.launcher.allChats") }}</OButton
            >
          </div>
          <ul v-if="state === 'loading'" class="flex flex-col gap-2">
            <li v-for="n in 3" :key="n"><OSkeleton type="text" class="h-8 w-full" /></li>
          </ul>
          <OEmptyState
            v-else-if="recent.length === 0"
            size="inline"
            icon="history"
            :backdrop="false"
            :title="t('assistant.welcome.launcher.noRecent')"
            :description="t('assistant.welcome.launcher.noRecentHint')"
            data-test="assistant-launcher-recent-empty"
          />
          <ul v-else class="flex flex-col gap-1">
            <li v-for="(row, index) in recent" :key="row.sid" class="min-w-0">
              <OButton
                variant="ghost"
                size="sm"
                block
                class="h-auto! min-h-8 justify-start! gap-2 py-1.5 text-start max-md:min-h-11 pointer-coarse:min-h-11"
                :data-test="`assistant-launcher-recent-${index}`"
                :data-status="row.status ?? undefined"
                @click="openChat(row.sid)"
              >
                <AssistantStatusDot
                  v-if="row.status"
                  :state="CHAT_STATUS_SIGNAL[row.status]"
                  placement="inline"
                />
                <OTruncatedText class="text-text-body min-w-0 flex-1">{{
                  row.title
                }}</OTruncatedText>
                <span v-if="row.status || row.at" class="sr-only">, </span>
                <OText
                  v-if="row.status"
                  variant="meta"
                  class="text-text-body shrink-0"
                  data-test="assistant-launcher-recent-status"
                >
                  {{ t(CHAT_STATUS_KEYS[row.status]) }}
                </OText>
                <OText v-else-if="row.at" variant="meta" class="shrink-0">{{ row.at }}</OText>
              </OButton>
            </li>
          </ul>
        </div>
      </div>
    </OCard>
  </section>
</template>

<script lang="ts">
/** The launcher's line is one prompt; longer text belongs in the full view's composer. */
export const MAX_LAUNCHER_CHARS = 4_000;

/** Rows of each column (`70` §2.1). */
export const LAUNCHER_ROWS = 3;

/** In-progress chats can sit below the latest ones, so Your chats looks this far down the list. */
const RECENT_LOOKUP = 20;

// G0 and G1 leave no gap on Home: the header carries the locked or muted button (DG-04 AC 3, DG-05 AC 1).
const HIDDEN_GATES: ReadonlySet<string> = new Set([
  "not_entitled",
  "not_configured",
  "off_for_org",
]);

/** What the card renders for a gate; `null` renders nothing. */
export function launcherState(gate: string): "loading" | "gate" | "ready" | null {
  if (gate === "loading") return "loading";
  if (HIDDEN_GATES.has(gate)) return null;
  if (gate === "no_permission") return "gate";
  return "ready";
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import { provideAssistantSurface } from "@/components/ai-assistant/common/assistantSurface";
import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import AssistantMark from "@/components/ai-assistant/common/AssistantMark.vue";
import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import {
  CHAT_STATUS_KEYS,
  CHAT_STATUS_SIGNAL,
  chatStatusOf,
  inProgressFirst,
  isInProgress,
} from "@/components/ai-assistant/history/chatStatus";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantContextSeesPopover from "@/components/ai-assistant/context/AssistantContextSeesPopover.vue";
import AssistantGateState from "@/components/ai-assistant/gate/AssistantGateState.vue";
import {
  openAssistant,
  starterPayload,
  timeRangeText,
  timeWindowOf,
  useAssistantCapability,
  useAssistantHistory,
  useAssistantName,
  useAssistantStarters,
  useAssistantStore,
  type Starter,
} from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatRelative } from "@/utils/formatters";

// Overlays opened from here are teleported to body, so they carry the assistant colour roles with them.
provideAssistantSurface();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const router = useRouter();
const vuex = useStore();
const capability = useAssistantCapability();
const assistant = useAssistantStore();
const { mdUp } = useBreakpoint();
const { starters, loading, scope } = useAssistantStarters({ page: "home" });

const titleId = `assistant-launcher-title-${useId()}`;
const disclosureId = `assistant-launcher-disclosure-${useId()}`;
const text = ref("");
const input = ref<InstanceType<typeof OInput> | null>(null);

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const state = computed(() => {
  const gated = launcherState(capability.gate.value);
  return gated === "ready" && loading.value ? "loading" : gated;
});
const shown = computed(() => state.value !== null);
const creditsExhausted = computed(() => capability.value.creditMode === "exhausted");
const shownStarters = computed(() => starters.value.slice(0, LAUNCHER_ROWS));
// The sidebar's own welcome already lists the starters, so Home shows one set (D5 decision 10).
const sidebarWelcome = computed(() => {
  const shell = assistant.state.shell;
  const sid = shell.activeSid;
  return (
    shell.placement.kind === "sidebar" && !(sid && assistant.state.sessions[sid]?.messages.length)
  );
});
const showSuggestions = computed(() => state.value !== "gate" && !sidebarWelcome.value);

// The full view sends what its own page shows; with no page range that is the default window.
const disclosure = computed(() =>
  t(
    scope.value.streamCount === 0
      ? "assistant.welcome.launcher.disclosureNoStreams"
      : "assistant.welcome.launcher.disclosure",
    { range: timeRangeText(timeWindowOf(null, null)) },
  ),
);

const history = useAssistantHistory();
const recentRows = history.recent(RECENT_LOOKUP);
const recent = computed(() =>
  inProgressFirst(
    recentRows.value.map((row) => ({
      sid: row.sid,
      title: row.title,
      status: chatStatusOf(row, assistant.state.sessions[row.sid]?.turn.state),
      at: row.updatedAt ? raw(formatRelative(row.updatedAt)) : null,
    })),
    (row) => row.status,
  ).slice(0, LAUNCHER_ROWS),
);
const hasInProgress = computed(() => recent.value.some((row) => isInProgress(row.status)));
onMounted(() => history.ensureLoaded());

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter") {
    event.preventDefault();
    ask(event.shiftKey);
  } else if (event.key === "Escape") {
    // Escape never clears what was typed; only the clear button does (round 1 X-20).
    (event.target as HTMLElement | null)?.blur();
  }
}

// The launcher is a door, not a composer: the line goes to `/assistant` and nothing stays here (`70` §5 note 6).
function ask(stage: boolean): void {
  if (state.value !== "ready") return;
  const line = text.value.trim();
  if (!line) return openFull();
  text.value = "";
  void openAssistant({
    entryKind: "home_launcher",
    entryVerb: "ask",
    objectKind: "none",
    intent: stage ? "stage" : "send",
    thread: "new",
    container: "full",
    payload: { text: line, chips: [] },
  });
}

function pickStarter(starter: Starter, index: number): void {
  trackAssistant("ai_welcome_starter", { starter_kind: starter.kind, index, via: "click" });
  // The full view's route opens the chat and shows its own not-found or deleted state.
  if (starter.kind === "recent" && (starter.sid || starter.chatId !== undefined)) {
    openChat(starter.sid ?? String(starter.chatId));
    return;
  }
  void openAssistant({
    entryKind: "home_launcher",
    entryVerb: "ask",
    objectKind: "none",
    intent: "stage",
    thread: "new",
    container: "full",
    payload: starterPayload(starter, org.value),
  });
}

function clear(): void {
  text.value = "";
  input.value?.focus();
}

function openFull(): void {
  void router.push({ name: "assistant" }).catch(() => undefined);
}

function openChat(sid: string): void {
  void router.push({ name: "assistant", params: { chatId: sid } }).catch(() => undefined);
}

function openBilling(): void {
  void router.push({ name: "plans", query: { org_identifier: org.value } }).catch(() => undefined);
}
</script>
