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
  <div
    ref="root"
    class="@container flex min-w-0 flex-1 items-center gap-2"
    :data-density="density"
    data-test="assistant-thread-header"
    :data-view="chatsOpen ? 'chats' : 'chat'"
  >
    <template v-if="chatsOpen">
      <AssistantIconButton
        ref="backButton"
        :label="t('assistant.history.view.back', { title: raw(String(titleText)) })"
        :icon="assistantGlyph.back"
        data-test="assistant-chats-back"
        @click="closeChats"
      />
      <h2
        class="text-text-heading min-w-0 flex-1 truncate text-sm font-medium"
        data-test="assistant-chats-title"
      >
        {{ t("assistant.history.view.title") }}
      </h2>
      <div class="flex shrink-0 items-center gap-1">
        <AssistantIconButton
          v-if="!readonly"
          :label="t('assistant.thread.newChat')"
          :icon="assistantGlyph.newChat"
          data-test="assistant-chats-new"
          @click="newFromList"
        />
        <slot name="container-actions" />
      </div>
    </template>
    <template v-else>
      <AssistantMark size="sm" />
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <div v-if="renaming" class="min-w-0 flex-1">
          <OInput
            ref="renameInput"
            :model-value="draft"
            size="sm"
            :aria-label="t('assistant.thread.renameLabel')"
            :help-text="draft.length >= COUNTER_FROM ? counter : undefined"
            data-test="assistant-thread-rename"
            @update:model-value="setDraft"
            @keydown="onRenameKey"
            @blur="commitRename"
          />
        </div>
        <h2
          v-else
          :aria-describedby="describedBy"
          :aria-busy="renamePending ? 'true' : undefined"
          :class="[
            'flex items-center gap-1.5 text-sm font-medium',
            renamable ? 'min-w-6 max-md:min-w-11 pointer-coarse:min-w-11' : 'min-w-0',
            density === 'dense' && 'max-md:max-w-[14rem]',
            renamePending ? 'text-text-secondary' : 'text-text-heading',
          ]"
          data-test="assistant-thread-title"
        >
          <OButton
            v-if="renamable"
            ref="heading"
            variant="ghost"
            size="sm"
            :disabled="renamePending"
            class="h-auto! min-h-6 min-w-6 justify-start! px-1! font-medium max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            data-test="assistant-thread-title-button"
            @click="startRename"
          >
            <OTruncatedText class="min-w-0">{{ titleText }}</OTruncatedText>
            <OTooltip :content="t('assistant.thread.rename')" />
          </OButton>
          <span v-else class="min-w-0" data-test="assistant-thread-title-text">
            <OTruncatedText class="min-w-0">{{ titleText }}</OTruncatedText>
            <OTooltip v-if="!hasMessages" :content="t('assistant.thread.renameDisabled')" />
          </span>
          <span v-if="notSavedHere" class="text-text-secondary shrink-0 font-normal">{{
            t("assistant.thread.notSavedSuffix")
          }}</span>
          <OSpinner v-if="renamePending" size="xs" />
        </h2>
        <OTag
          v-if="saveTag"
          :id="saveTagId"
          type="assistantSave"
          :value="saveTag"
          size="xs"
          class="shrink-0"
          data-test="assistant-thread-save-tag"
        />
        <OTag
          v-if="originTag"
          type="assistantOrigin"
          :value="originTag"
          size="xs"
          class="shrink-0"
          data-test="assistant-thread-origin"
        />
        <slot name="tags" />
        <span v-if="$slots['share-chip']" :id="shareChipId" class="contents">
          <slot name="share-chip" />
        </span>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <template v-if="density === 'default'">
          <OButton
            ref="chatsButton"
            variant="ghost"
            size="sm"
            :icon-left="assistantGlyph.history"
            :aria-label="t('assistant.thread.chats')"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-thread-history"
            @click="openChats"
          >
            <span class="@max-[32rem]:sr-only">{{ t("assistant.thread.chats") }}</span>
            <OTooltip :content="t('assistant.thread.chats')" shortcut-id="assistantHistory" />
          </OButton>
          <template v-if="!readonly && hasMessages">
            <ODropdown v-if="localMode" align="end">
              <template #trigger>
                <AssistantIconButton
                  :label="t('assistant.thread.download')"
                  :icon="assistantGlyph.download"
                  :loading="downloading"
                  data-test="assistant-thread-download"
                />
              </template>
              <ODropdownItem
                data-test="assistant-thread-download-markdown"
                @select="download('markdown')"
              >
                {{ t("assistant.thread.downloadMarkdown") }}
              </ODropdownItem>
              <ODropdownItem data-test="assistant-thread-download-json" @select="download('json')">
                {{ t("assistant.thread.downloadJson") }}
              </ODropdownItem>
            </ODropdown>
            <slot v-else name="share" />
          </template>
          <AssistantIconButton
            v-if="!readonly"
            :label="t('assistant.thread.newChat')"
            :icon="assistantGlyph.newChat"
            data-test="assistant-thread-new"
            @click="askNew"
          />
        </template>

        <ODropdown v-model:open="menuOpen" align="end" privacy="mask">
          <template #trigger>
            <AssistantIconButton
              :label="t('assistant.thread.menu')"
              :icon="assistantGlyph.more"
              :loading="downloading && !localMode"
              data-test="assistant-thread-menu"
            />
          </template>
          <template v-if="density === 'dense'">
            <ODropdownItem
              :icon-left="assistantGlyph.history"
              shortcut-id="assistantHistory"
              data-test="assistant-thread-menu-history"
              @select="openChats"
            >
              {{ t("assistant.thread.chats") }}
            </ODropdownItem>
            <ODropdownItem
              v-if="!readonly"
              :icon-left="assistantGlyph.newChat"
              data-test="assistant-thread-menu-new"
              @select="askNew"
            >
              {{ t("assistant.thread.newChat") }}
            </ODropdownItem>
            <ODropdownSeparator v-if="$slots['menu-layout'] || chatActions" />
          </template>
          <slot name="menu-layout" />
          <template v-if="chatActions">
            <ODropdownSeparator v-if="$slots['menu-layout']" />
            <ODropdownItem data-test="assistant-thread-menu-rename" @select="startRenameSoon">
              {{ t("assistant.thread.rename") }}
            </ODropdownItem>
            <ODropdownItem data-test="assistant-thread-menu-pin" @select="togglePin">
              {{ pinned ? t("assistant.thread.unpin") : t("assistant.thread.pin") }}
            </ODropdownItem>
            <ODropdownSub
              v-if="!localMode || density === 'dense'"
              :text-value="t('assistant.thread.download')"
            >
              <template #trigger>{{ t("assistant.thread.download") }}</template>
              <ODropdownItem
                data-test="assistant-thread-menu-download-markdown"
                @select="download('markdown')"
              >
                {{ t("assistant.thread.downloadMarkdown") }}
              </ODropdownItem>
              <ODropdownItem
                data-test="assistant-thread-menu-download-json"
                @select="download('json')"
              >
                {{ t("assistant.thread.downloadJson") }}
              </ODropdownItem>
            </ODropdownSub>
            <slot name="menu-share" />
            <ODropdownSeparator />
            <ODropdownItem
              variant="destructive"
              data-test="assistant-thread-menu-delete"
              @select="deleteOpen = true"
            >
              {{ t("assistant.thread.delete") }}
            </ODropdownItem>
          </template>
        </ODropdown>
        <slot name="container-actions" />
      </div>
    </template>

    <AssistantHistoryConfirm
      v-if="sid"
      kind="delete"
      :open="deleteOpen"
      :mode="history.mode.value"
      :org="org"
      :org-name="orgName"
      :sid="sid"
      :chat-title="String(titleText)"
      :running="running"
      @update:open="(open) => (deleteOpen = open)"
      @confirm="confirmDelete"
    />
  </div>
</template>

<script lang="ts">
import type { InjectionKey, Ref } from "vue";

import type { Container, Placement, Sid } from "@/composables/assistant";

export interface AssistantThreadHeaderProps {
  sid: Sid | null;
  placement: Placement["kind"] | "sheet";
  /** Docked, sheet and below md: title and overflow only. */
  density: "default" | "dense";
  container: Container;
}

/** What the shell lends the header: its own New, and the in-panel Chats view that replaces its body. */
export interface AssistantThreadHost {
  newChat(): void;
  chats?: { open: Readonly<Ref<boolean>>; set(open: boolean): void };
}

export const assistantThreadHostKey: InjectionKey<AssistantThreadHost> =
  Symbol("assistantThreadHost");

const MAX_TITLE = 200;
const COUNTER_FROM = 180;
const HEADER_PRIORITY = 1;
</script>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { useStore } from "vuex";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import AssistantMark from "@/components/ai-assistant/common/AssistantMark.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantHistoryConfirm from "@/components/ai-assistant/history/AssistantHistoryConfirm.vue";
import {
  historyTargetAbove,
  hostOrgName,
  isRunning,
  originOf,
  registerHistoryTarget,
  runHistoryTarget,
  useAssistantCapability,
  useAssistantHistory,
  useAssistantStore,
  useChatExport,
} from "@/composables/assistant";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import ODropdownSub from "@/lib/overlay/Dropdown/ODropdownSub.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<AssistantThreadHeaderProps>();

defineSlots<{
  "container-actions"?: () => unknown;
  "menu-layout"?: () => unknown;
  "share-chip"?: () => unknown;
  share?: () => unknown;
  "menu-share"?: () => unknown;
  tags?: () => unknown;
}>();

const { t } = useI18nTyped();
const store = useAssistantStore();
const history = useAssistantHistory();
const capability = useAssistantCapability();
const exporter = useChatExport();
const host = inject(assistantThreadHostKey, null);
const vuex = useStore();
const root = ref<HTMLElement | null>(null);
const heading = ref<InstanceType<typeof OButton> | null>(null);
const renameInput = ref<InstanceType<typeof OInput> | null>(null);
const chatsButton = ref<InstanceType<typeof OButton> | null>(null);
const backButton = ref<InstanceType<typeof AssistantIconButton> | null>(null);
const renaming = ref(false);
const draft = ref("");
const menuOpen = ref(false);
const deleteOpen = ref(false);
const id = useId();
const saveTagId = `assistant-thread-${id}-save`;
const shareChipId = `assistant-thread-${id}-share`;
let cancelled = false;

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const orgName = computed(() => hostOrgName(org.value));
const chatsOpen = computed(() => host?.chats?.open.value ?? false);
const session = computed(() => (props.sid ? (store.state.sessions[props.sid] ?? null) : null));
const hasMessages = computed(() => (session.value?.messages.length ?? 0) > 0);
const titleText = computed(() => session.value?.title ?? t("assistant.thread.newChatTitle"));
const readonly = computed(() => capability.value.canChat === "no");
const localMode = computed(() => history.mode.value === "local");
const renamable = computed(() => hasMessages.value && !readonly.value);
const renamePending = computed(() => !!props.sid && history.pending[props.sid] === "rename");
const pinned = computed(() => !!session.value?.record.pinned);
const running = computed(
  () => !!session.value && (isRunning(session.value.turn) || !!session.value.pendingApproval),
);
const notSavedHere = computed(() => history.notSaved(props.sid));
// An analysis chat keeps saying what it was about once reopened outside its incident.
const originTag = computed(() =>
  session.value && originOf(session.value.origin) === "incident" ? "incident" : null,
);
const saveTag = computed(() => {
  const current = session.value;
  if (!current) return null;
  if (current.record.historyUnavailable) return "history_unavailable";
  const turn = current.turn;
  if (notSavedHere.value || (turn.state === "done" && turn.saved === "not_saved"))
    return "not_saved";
  return null;
});
const describedBy = computed(() => {
  const ids = [saveTag.value && saveTagId].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
});
const chatActions = computed(() => hasMessages.value && !readonly.value && !!props.sid);
const menuTrigger = computed(
  () => root.value?.querySelector<HTMLElement>('[data-test="assistant-thread-menu"]') ?? null,
);
const counter = computed(() => t("assistant.thread.titleCounter", { count: draft.value.length }));
const downloading = computed(() => !!props.sid && exporter.busy.value.has(props.sid));

async function startRename(): Promise<void> {
  if (!renamable.value || renamePending.value) return;
  draft.value = String(titleText.value);
  cancelled = false;
  renaming.value = true;
  await nextTick();
  renameInput.value?.focus();
  (renameInput.value?.$el as HTMLElement | undefined)?.querySelector("input")?.select();
}

// The menu returns focus to its trigger as it closes; the field waits for that.
function startRenameSoon(): void {
  setTimeout(() => void startRename(), 0);
}

// OInput's own counter shows from the first character; this one starts near the limit.
function setDraft(value: string | number): void {
  draft.value = String(value).slice(0, MAX_TITLE);
}

function onRenameKey(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter") {
    event.preventDefault();
    commitRename();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelled = true;
    void finishRename();
  }
}

function commitRename(): void {
  if (!renaming.value) return;
  const next = draft.value.trim();
  const sid = props.sid;
  if (!cancelled && sid && next && next !== String(titleText.value)) void history.rename(sid, next);
  void finishRename();
}

async function finishRename(): Promise<void> {
  renaming.value = false;
  await nextTick();
  (heading.value?.$el as HTMLElement | undefined)?.focus();
}

function togglePin(): void {
  if (props.sid) void history.pin(props.sid, !pinned.value);
}

function download(format: "markdown" | "json"): void {
  if (props.sid) void exporter.exportChat(props.sid, format);
}

// The full view's rail is the list there; Chats moves focus to it instead of opening a second one.
function openChats(): void {
  if (historyTargetAbove(HEADER_PRIORITY)) {
    runHistoryTarget();
    return;
  }
  host?.chats?.set(true);
}

function closeChats(): void {
  host?.chats?.set(false);
  void nextTick(focusChats);
}

/** Chats lives in More when dense, so focus goes back to whichever holds it. */
function focusChats(): void {
  const target = props.density === "dense" ? menuTrigger.value : chatsButton.value?.$el;
  (target as HTMLElement | null | undefined)?.focus();
}

function newFromList(): void {
  host?.chats?.set(false);
  askNew();
}

// New never asks (PO A12): a running answer keeps going and a pending approval stays pending.
function askNew(): void {
  const previous = running.value ? props.sid : null;
  const title = String(titleText.value);
  const before = store.state.shell.activeSid;
  if (host) host.newChat();
  else history.create();
  if (store.state.shell.activeSid === before) return;
  history.announceText(t("assistant.thread.newAnnounce"));
  trackAssistant("ai_thread_action", { action: "new", had_running: !!previous });
  if (previous) keepsAnswering(previous, title);
}

function keepsAnswering(sid: Sid, title: string): void {
  toast({
    variant: "default",
    message: t("assistant.thread.keepsAnswering", { title: raw(title) }),
    action: {
      label: t("assistant.history.open"),
      handler: () => void store.openSession({ sid }, { focus: true }).catch(() => undefined),
    },
  });
}

async function confirmDelete(): Promise<void> {
  deleteOpen.value = false;
  if (props.sid) await history.remove(props.sid);
}

/** The `assistantHistory` chord: toggles the Chats view and returns focus to Chats when it closes. */
function toggleHistory(): void {
  if (chatsOpen.value) closeChats();
  else openChats();
}

function focusBack(): void {
  (backButton.value?.$el as HTMLElement | undefined)?.focus();
}

let unregisterHistory: (() => void) | null = null;
onMounted(() => {
  unregisterHistory = registerHistoryTarget({
    el: () => root.value,
    priority: HEADER_PRIORITY,
    run: toggleHistory,
  });
});
onBeforeUnmount(() => unregisterHistory?.());

defineExpose({ toggleHistory, startRename, askNew, focusChats, focusBack });
</script>
