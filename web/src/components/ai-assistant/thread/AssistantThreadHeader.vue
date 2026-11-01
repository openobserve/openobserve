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
    class="flex min-w-0 flex-1 items-center gap-1"
    data-test="assistant-thread-header"
    :data-narrow="narrow ? '' : undefined"
    :data-view="chatsOpen ? 'chats' : 'chat'"
  >
    <template v-if="chatsOpen">
      <AssistantIconButton
        ref="backButton"
        :label="t('assistant.history.view.back', { title: raw(String(titleText)) })"
        :icon="assistantGlyph.back"
        size="xs"
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
          v-if="newShown"
          :label="newLabel"
          :icon="assistantGlyph.newChat"
          size="xs"
          data-test="assistant-chats-new"
          @click="newFromList"
        />
        <slot name="container-actions" :narrow="narrow" />
      </div>
    </template>
    <template v-else>
      <div v-if="renaming" class="min-w-0 flex-1" data-test="assistant-thread-rename">
        <OInlineEdit
          ref="renameInput"
          v-model="draft"
          size="sm"
          :aria-label="t('assistant.thread.renameLabel')"
          :maxlength="MAX_TITLE"
          @commit="commitRename"
          @cancel="cancelRename"
        />
      </div>
      <div v-else class="relative flex min-w-0 flex-1 items-center gap-2">
        <h2
          :aria-describedby="describedBy"
          :aria-busy="renamePending ? 'true' : undefined"
          :class="[
            'flex min-w-0 items-center text-sm font-medium',
            renamePending ? 'text-text-secondary' : 'text-text-heading',
          ]"
          data-test="assistant-thread-title"
        >
          <ODropdown
            v-model:open="menuOpen"
            side="bottom"
            align="start"
            privacy="mask"
            :content-class="menuWidth"
          >
            <template #trigger>
              <OButton
                ref="heading"
                variant="ghost"
                size="xs"
                :disabled="renamePending"
                :aria-label="titleName"
                aria-haspopup="menu"
                class="max-w-full min-w-0 justify-start! gap-1 text-sm! font-medium text-inherit! max-md:min-h-11 pointer-coarse:min-h-11"
                data-test="assistant-thread-title-button"
              >
                <OTruncatedText class="min-w-0">{{ titleText }}</OTruncatedText>
                <OIcon
                  :name="menuOpen ? assistantGlyph.collapse : assistantGlyph.expand"
                  size="xs"
                  class="text-text-secondary shrink-0"
                  aria-hidden="true"
                />
                <span
                  v-if="mark"
                  class="text-text-body ms-1 inline-flex shrink-0 items-center gap-1 text-xs tabular-nums"
                  :data-state="mark.signal"
                  data-test="assistant-title-mark"
                >
                  <AssistantStatusDot :state="mark.signal" />
                  <span>{{ mark.count }}</span>
                </span>
                <OSpinner v-if="renamePending" size="xs" />
                <OTooltip :content="titleTooltip" max-width="22.5rem" />
              </OButton>
            </template>
            <AssistantTitleMenu
              :sid="sid"
              :new-chat="placement === 'window' && !readonly"
              :actions-only="placement === 'full' && chatActions"
              @new="askNew"
              @open="openChat"
              @all="openChats"
            >
              <template v-if="chatActions || foldedLayout" #default>
                <template v-if="chatActions">
                  <div
                    class="flex min-w-0 flex-col gap-1 px-3 py-1.5"
                    data-test="assistant-title-menu-header"
                  >
                    <OTruncatedText class="text-text-heading min-w-0 text-sm font-medium">{{
                      titleText
                    }}</OTruncatedText>
                    <OTag
                      v-if="narrow && saveTag"
                      type="assistantSave"
                      :value="saveTag"
                      size="xs"
                      class="self-start"
                    />
                  </div>
                  <slot name="menu-share" />
                  <ODropdownItem
                    :icon-left="assistantGlyph.edit"
                    data-test="assistant-thread-menu-rename"
                    @select="startRenameSoon"
                  >
                    {{ t("assistant.thread.rename") }}
                  </ODropdownItem>
                  <ODropdownItem
                    :icon-left="assistantGlyph.pin"
                    data-test="assistant-thread-menu-pin"
                    @select="togglePin"
                  >
                    {{ pinned ? t("assistant.thread.unpin") : t("assistant.thread.pin") }}
                  </ODropdownItem>
                  <ODropdownSub :text-value="t('assistant.thread.download')">
                    <template #icon-left
                      ><OIcon :name="assistantGlyph.download" size="sm"
                    /></template>
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
                </template>
                <ODropdownSub v-if="foldedLayout" :text-value="t('assistant.shell.layout')">
                  <template #icon-left><OIcon :name="assistantGlyph.layout" size="sm" /></template>
                  <template #trigger>
                    <span data-test="assistant-title-menu-layout">{{
                      t("assistant.shell.layout")
                    }}</span>
                  </template>
                  <slot name="menu-layout" />
                </ODropdownSub>
                <template v-if="chatActions">
                  <ODropdownSeparator />
                  <ODropdownItem
                    variant="destructive"
                    :icon-left="assistantGlyph.remove"
                    data-test="assistant-thread-menu-delete"
                    @select="deleteOpen = true"
                  >
                    {{ t("assistant.thread.delete") }}
                  </ODropdownItem>
                </template>
              </template>
            </AssistantTitleMenu>
          </ODropdown>
        </h2>
        <OTag
          v-if="saveTag && !narrow"
          :id="saveTagId"
          type="assistantSave"
          :value="saveTag"
          size="xs"
          class="shrink-0"
          data-test="assistant-thread-save-tag"
        />
        <slot name="title-anchor" />
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <AssistantIconButton
          v-if="newShown && placement !== 'window'"
          :label="newLabel"
          :icon="assistantGlyph.newChat"
          size="xs"
          data-test="assistant-thread-new"
          @click="askNew"
        />
        <slot name="container-actions" :narrow="narrow" />
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
  placement: Placement["kind"] | "window" | "sheet";
  container: Container;
  /** The container already knows it is below 24 rem, as a window does from its geometry. */
  narrow?: boolean;
}

/** What the shell lends the header: its own New, and the in-panel Chats view that replaces its body. */
export interface AssistantThreadHost {
  newChat(): void;
  /** The chat this host shows, when it is not the primary container's. */
  currentSid?(): Sid | null;
  /** Opens a chat in this container: a window swaps its own chat, the primary goes through the store. */
  openChat?(sid: Sid): Promise<Sid>;
  chats?: { open: Readonly<Ref<boolean>>; set(open: boolean): void };
  /** A dock's bar is about its object: the title when no chat has one, and what `+` starts. */
  object?(): { title: string; newLabel: string } | null;
}

export const assistantThreadHostKey: InjectionKey<AssistantThreadHost> =
  Symbol("assistantThreadHost");

const MAX_TITLE = 200;
const HEADER_PRIORITY = 1;
const NARROW_REM = 24;
const REM_PX = 16;
</script>

<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  useSlots,
  type ComponentPublicInstance,
} from "vue";
import { useStore } from "vuex";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantHistoryConfirm from "@/components/ai-assistant/history/AssistantHistoryConfirm.vue";
import {
  historyTargetAbove,
  hostOrgName,
  isRunning,
  registerHistoryTarget,
  runHistoryTarget,
  useAssistantCapability,
  useAssistantHistory,
  useAssistantRuns,
  useAssistantStore,
  useChatExport,
} from "@/composables/assistant";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInlineEdit from "@/lib/forms/InlineEdit/OInlineEdit.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import ODropdownSub from "@/lib/overlay/Dropdown/ODropdownSub.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import AssistantTitleMenu from "./AssistantTitleMenu.vue";

const props = defineProps<AssistantThreadHeaderProps>();

defineSlots<{
  "container-actions"?: (props: { narrow: boolean }) => unknown;
  "menu-layout"?: () => unknown;
  "menu-share"?: () => unknown;
  "title-anchor"?: () => unknown;
}>();

const { t } = useI18nTyped();
const slots = useSlots();
const store = useAssistantStore();
const history = useAssistantHistory();
const runs = useAssistantRuns();
const capability = useAssistantCapability();
const exporter = useChatExport();
const host = inject(assistantThreadHostKey, null);
const vuex = useStore();
const root = ref<HTMLElement | null>(null);
const heading = ref<ComponentPublicInstance | null>(null);
const renameInput = ref<InstanceType<typeof OInlineEdit> | null>(null);
const backButton = ref<InstanceType<typeof AssistantIconButton> | null>(null);
const renaming = ref(false);
const draft = ref("");
const menuOpen = ref(false);
const deleteOpen = ref(false);
const widthRem = ref(Number.POSITIVE_INFINITY);
const saveTagId = `assistant-thread-${useId()}-save`;
let sizes: ResizeObserver | null = null;

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const orgName = computed(() => hostOrgName(org.value));
const chatsOpen = computed(() => host?.chats?.open.value ?? false);
const session = computed(() => (props.sid ? (store.state.sessions[props.sid] ?? null) : null));
const hasMessages = computed(() => (session.value?.messages.length ?? 0) > 0);
const object = computed(() => host?.object?.() ?? null);
const titleText = computed(
  () => session.value?.title ?? object.value?.title ?? t("assistant.thread.newChatTitle"),
);
const readonly = computed(() => capability.value.canChat === "no");
const pinned = computed(() => !!session.value?.record.pinned);
const renamePending = computed(() => !!props.sid && history.pending[props.sid] === "rename");
const running = computed(
  () => !!session.value && (isRunning(session.value.turn) || !!session.value.pendingApproval),
);
const notSavedHere = computed(() => history.notSaved(props.sid));
const saveTag = computed(() => {
  const current = session.value;
  if (!current) return null;
  if (current.record.historyUnavailable) return "history_unavailable";
  const turn = current.turn;
  if (notSavedHere.value || (turn.state === "done" && turn.saved === "not_saved"))
    return "not_saved";
  return null;
});
const describedBy = computed(() => (saveTag.value && !narrow.value ? saveTagId : undefined));
const chatActions = computed(() => hasMessages.value && !readonly.value && !!props.sid);
// Nothing to leave in an empty chat, and a read-only role cannot start one.
const newShown = computed(() => !readonly.value && (hasMessages.value || chatsOpen.value));
const newLabel = computed<I18nText>(() =>
  object.value ? raw(object.value.newLabel) : t("assistant.thread.newChat"),
);
const narrow = computed(
  () => props.narrow || props.placement === "sheet" || widthRem.value < NARROW_REM,
);
const foldedLayout = computed(() => narrow.value && !!slots["menu-layout"]);
const menuWidth = computed(() => {
  if (narrow.value) return "w-70 max-w-[calc(100vw-1rem)]";
  return props.placement === "window" ? "w-75" : "w-80";
});

// One mark: amber while any other chat waits, else the ring while others answer; never this chat's state.
const others = computed(() => runs.rows.value.filter((row) => row.sid !== props.sid));
const needs = computed(() => others.value.filter((row) => row.group === "needs_you").length);
const answering = computed(() => others.value.filter((row) => row.group === "answering").length);
const mark = computed(() => {
  if (needs.value) return { signal: "attention" as const, count: needs.value };
  return answering.value ? { signal: "working" as const, count: answering.value } : null;
});
const titleName = computed(() => {
  const title = raw(String(titleText.value));
  const count = mark.value?.count ?? 0;
  if (!mark.value) return t("assistant.thread.titleName", { title });
  return mark.value.signal === "attention"
    ? t("assistant.thread.titleNameNeeds", { title, count }, count)
    : t("assistant.thread.titleNameAnswering", { title, count }, count);
});
const titleTooltip = computed<I18nText>(() => {
  if (!mark.value) return raw(String(titleText.value));
  const parts = [t("assistant.runs.summary.answering", { count: answering.value })];
  if (needs.value)
    parts.unshift(t("assistant.runs.summary.needs", { count: needs.value }, needs.value));
  return t("assistant.thread.titleTooltip", {
    title: raw(String(titleText.value)),
    summary: raw(parts.map(String).join(", ")),
  });
});
const downloading = computed(() => !!props.sid && exporter.busy.value.has(props.sid));

function startRename(): void {
  if (!chatActions.value || renamePending.value) return;
  draft.value = String(titleText.value);
  renaming.value = true;
  void nextTick(() => renameInput.value?.focus());
}

// The menu returns focus to its trigger as it closes; the field waits for that.
function startRenameSoon(): void {
  setTimeout(startRename, 0);
}

function commitRename(value: string): void {
  if (!renaming.value) return;
  const next = value.trim().slice(0, MAX_TITLE);
  if (props.sid && next && next !== String(titleText.value)) void history.rename(props.sid, next);
  void finishRename();
}

function cancelRename(): void {
  void finishRename();
}

async function finishRename(): Promise<void> {
  renaming.value = false;
  await nextTick();
  focusTitle();
}

function focusTitle(): void {
  (heading.value?.$el as HTMLElement | undefined)?.focus();
}

function togglePin(): void {
  if (props.sid) void history.pin(props.sid, !pinned.value);
}

function download(format: "markdown" | "json"): void {
  if (props.sid && !downloading.value) void exporter.exportChat(props.sid, format);
}

// The full view's rail is the list there; All chats moves focus to it instead of opening a second one.
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

/** All chats opens from the title menu, so focus goes back to its trigger. */
function focusChats(): void {
  focusTitle();
}

function openChat(sid: Sid): void {
  const opening = host?.openChat?.(sid) ?? store.openSession({ sid }, { focus: true });
  void opening.catch(() => toast({ variant: "error", message: t("assistant.history.openFailed") }));
}

function newFromList(): void {
  host?.chats?.set(false);
  askNew();
}

// New never asks (PO A12): a running answer keeps going and a pending approval stays pending.
function askNew(): void {
  const previous = running.value ? props.sid : null;
  const title = String(titleText.value);
  const shownChat = () => host?.currentSid?.() ?? store.state.shell.activeSid;
  const before = shownChat();
  if (host) host.newChat();
  else history.create();
  if (shownChat() === before) return;
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

/** The `assistantHistory` chord: toggles All chats and returns focus to the title when it closes. */
function toggleHistory(): void {
  if (chatsOpen.value) closeChats();
  else openChats();
}

function focusBack(): void {
  (backButton.value?.$el as HTMLElement | undefined)?.focus();
}

// The bar's own width, since 24 rem is a container's width and this row sits inside its padding.
function barEl(): HTMLElement | null {
  return root.value?.parentElement ?? root.value;
}

function measure(): void {
  const width = barEl()?.getBoundingClientRect().width ?? 0;
  // A hidden container measures 0, which says nothing about its width.
  if (width > 0) widthRem.value = width / REM_PX;
}

let unregisterHistory: (() => void) | null = null;
onMounted(() => {
  unregisterHistory = registerHistoryTarget({
    el: () => root.value,
    priority: HEADER_PRIORITY,
    run: toggleHistory,
  });
  measure();
  const bar = barEl();
  if (typeof ResizeObserver === "undefined" || !bar) return;
  sizes = new ResizeObserver(measure);
  sizes.observe(bar);
});
onBeforeUnmount(() => {
  unregisterHistory?.();
  sizes?.disconnect();
});

defineExpose({ toggleHistory, startRename, askNew, focusChats, focusBack, openChats });
</script>
