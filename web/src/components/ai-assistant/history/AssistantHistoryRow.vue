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
  <component
    :is="tag"
    :role="tag === 'div' ? 'listitem' : undefined"
    :class="[
      'group/row rounded-default hover:bg-surface-subtle relative flex min-w-0 items-center gap-1',
      current && 'bg-surface-subtle',
      compact && '-mx-2 px-2',
    ]"
    :aria-busy="pending ? 'true' : undefined"
    :data-sid="row.sid"
    :data-current="current ? '' : undefined"
    data-test="assistant-history-item"
    @pointerenter="arm"
    @focusin="arm"
    @touchstart.passive="arm"
  >
    <div v-if="renaming" class="min-w-0 flex-1 py-1">
      <OInput
        ref="renameInput"
        :model-value="draft"
        size="sm"
        :aria-label="t('assistant.thread.renameLabel')"
        :help-text="draft.length >= COUNTER_FROM ? counter : undefined"
        data-test="assistant-history-rename"
        @update:model-value="setDraft"
        @keydown="onRenameKey"
        @blur="commitRename"
      />
    </div>
    <OContextMenu v-else :disabled="readonly || !!pending || !actions.length">
      <template #trigger>
        <OButton
          ref="button"
          variant="ghost"
          size="sm"
          block
          :tabindex="tabbable ? 0 : -1"
          :aria-current="current ? 'true' : undefined"
          :class="[
            'h-auto! min-w-0 flex-1 justify-start! px-0! py-1.5 text-start max-md:min-h-11 pointer-coarse:min-h-11',
            compact ? 'min-h-9' : 'min-h-8',
          ]"
          data-test="assistant-history-row"
          :aria-disabled="org ? 'true' : undefined"
          @click="choose"
          @keydown="onRowKey"
          @pointerleave="chosen = false"
          @blur="chosen = false"
        >
          <span class="flex min-w-0 flex-1 items-center gap-2">
            <!-- A fixed slot keeps every title on one edge whether or not its row has a light -->
            <span
              :class="[
                'inline-flex shrink-0',
                compact ? 'w-3 justify-start' : 'w-4 justify-center',
              ]"
              data-test="assistant-history-row-light"
              :data-signal="signal ?? (compact ? 'ready' : undefined)"
            >
              <AssistantStatusDot v-if="signal" :state="signal" />
              <!-- A compact row at rest still marks its slot, so no title sits beside a blank gutter -->
              <span
                v-else-if="compact"
                aria-hidden="true"
                class="bg-border-default size-1.5 rounded-full"
              />
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <!-- A chosen row moves as the list re-sorts, so its bubble would be left over the nav (X1) -->
              <!-- The row is a button, whose nowrap would stop the 2-line clamp from wrapping or showing its ellipsis -->
              <OTruncatedText
                :class="[
                  'text-text-body min-w-12',
                  !compact && 'wrap-break-word whitespace-normal',
                ]"
                :lines="compact ? 1 : 2"
                :tooltip="chosen ? false : fullTitle"
                >{{ row.title }}</OTruncatedText
              >
              <OText v-if="org" variant="meta" as="span" data-test="assistant-history-row-org">
                {{ org }}
              </OText>
            </span>
            <OIcon
              v-if="agentIcon"
              :name="agentIcon"
              size="xs"
              class="text-text-secondary shrink-0"
              aria-hidden="true"
              data-test="assistant-history-row-agent"
            />
            <template v-if="visibility">
              <OIcon
                :name="visibility === 'public' ? assistantGlyph.shared : 'corporate-fare'"
                size="xs"
                class="text-text-secondary shrink-0"
                aria-hidden="true"
                data-test="assistant-history-row-shared"
                :data-visibility="visibility"
              />
              <span class="sr-only"
                >,
                {{
                  visibility === "public"
                    ? t("assistant.history.sharedPublic")
                    : t("assistant.share.sharedOrg")
                }}</span
              >
            </template>
            <!-- The button is named by its content; these keep the spoken parts apart. -->
            <span class="sr-only">, </span>
            <template v-if="pending">
              <OSpinner size="xs" />
              <OText variant="meta" data-test="assistant-history-row-pending">{{
                pendingText
              }}</OText>
            </template>
            <span
              v-else-if="status === 'answering'"
              :class="[
                'flex shrink-0 items-center justify-end',
                compact ? COMPACT_TRAIL_CLASS : 'w-12',
              ]"
              data-status="answering"
              data-test="assistant-history-row-state"
            >
              <span class="sr-only" aria-live="polite">{{
                chatStatusWord(status, expiresAt, now ?? Date.now(), t)
              }}</span>
              <span
                aria-hidden="true"
                class="flex items-center gap-0.5"
                data-test="assistant-history-row-working"
              >
                <span class="bg-text-secondary size-1 rounded-full motion-safe:animate-pulse" />
                <span
                  class="bg-text-secondary size-1 rounded-full motion-safe:animate-pulse motion-safe:[animation-delay:200ms]"
                />
                <span
                  class="bg-text-secondary size-1 rounded-full motion-safe:animate-pulse motion-safe:[animation-delay:400ms]"
                />
              </span>
            </span>
            <span
              v-else-if="status === 'needs_you' && quietStatus"
              class="sr-only"
              data-status="needs_you"
              data-test="assistant-history-row-state"
              >{{ chatStatusWord(status, expiresAt, now ?? Date.now(), t) }}</span
            >
            <span
              v-else-if="status"
              :class="[
                'group-hover/row:text-text-body min-w-12 shrink-0 text-end text-xs tabular-nums',
                chatStatusClass(status, current),
                compact && COMPACT_TRAIL_CLASS,
              ]"
              :data-status="status"
              data-test="assistant-history-row-state"
              >{{ chatStatusWord(status, expiresAt, now ?? Date.now(), t) }}</span
            >
            <OText
              v-else
              variant="meta"
              as="span"
              :class="[
                'group-hover/row:text-text-body! shrink-0 text-end tabular-nums',
                compact ? COMPACT_TRAIL_CLASS : 'w-12',
                current && 'text-text-body!',
              ]"
              data-test="assistant-history-row-time"
              >{{ time }}</OText
            >
          </span>
        </OButton>
      </template>
      <template v-for="action in actions" :key="action.id">
        <OContextMenuSeparator v-if="isDestructive(action.id) && actions.length > 1" />
        <OContextMenuItem
          :variant="isDestructive(action.id) ? 'destructive' : 'default'"
          @select="run(action.id)"
        >
          {{ action.label }}
        </OContextMenuItem>
      </template>
    </OContextMenu>
    <!-- The menu mounts once the row is pointed at or focused; a long list stays light until then. -->
    <AssistantIconButton
      v-if="!renaming && actions.length && !armed"
      :label="t('assistant.history.rowMenu', { title: raw(String(row.title)) })"
      :icon="assistantGlyph.more"
      :disabled="!!pending"
      :disabled-reason="pending ? pendingText : undefined"
      no-tooltip
      :class="[KEBAB_CLASS, compact && COMPACT_KEBAB_CLASS]"
      data-test="assistant-history-row-menu"
      @click="openMenuSoon"
    />
    <ODropdown
      v-else-if="!renaming && actions.length"
      v-model:open="menuOpen"
      align="end"
      privacy="mask"
    >
      <template #trigger>
        <AssistantIconButton
          ref="kebab"
          :label="t('assistant.history.rowMenu', { title: raw(String(row.title)) })"
          :icon="assistantGlyph.more"
          :disabled="!!pending"
          :disabled-reason="pending ? pendingText : undefined"
          no-tooltip
          :class="[KEBAB_CLASS, compact && COMPACT_KEBAB_CLASS]"
          data-test="assistant-history-row-menu"
        />
      </template>
      <template v-for="action in actions" :key="action.id">
        <ODropdownSeparator v-if="isDestructive(action.id) && actions.length > 1" />
        <ODropdownItem
          :icon-left="action.icon"
          :variant="isDestructive(action.id) ? 'destructive' : 'default'"
          :disabled="action.reason !== undefined"
          :focusable-unavailable="action.reason !== undefined"
          :description="action.reason"
          :data-test="`assistant-history-row-${action.id}`"
          @select="run(action.id)"
        >
          {{ action.label }}
        </ODropdownItem>
      </template>
    </ODropdown>
  </component>
</template>

<script lang="ts">
import type { HistoryPending, HistoryRow, Sid } from "@/composables/assistant";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import type { I18nText } from "@/types/i18n";

import type { ChatStatus } from "./chatStatus";

export interface AssistantHistoryRowProps {
  row: HistoryRow;
  current: boolean;
  mode: "panel" | "rail";
  /** The chat's status word; the list adds this tab's failed turns, which the row alone cannot see. */
  status?: ChatStatus | null;
  /** When a waiting chat's request ends, for the row's countdown. */
  expiresAt?: number | null;
  /** The list's clock, so a countdown and every age move together. */
  now?: number;
  /** Another org's chat: the org is its second line, and it never opens in place (PO B51). */
  org?: string | null;
  /** The agent's glyph; only with two or more agents, then on every row. */
  agentIcon?: IconName | null;
  /** How the owner shared the chat, when a live link points at it; the row alone does not know. */
  sharedAs?: "org" | "public" | null;
  /** Why the chat cannot float here, when it cannot. */
  floatBlocked?: I18nText;
  pending: HistoryPending | null;
  /** The one row button in the Tab order (roving tabindex). */
  tabbable: boolean;
  /** G2: rows open read-only and offer no changes. */
  readonly?: boolean;
  serverMode: boolean;
  /** Pins live on the server only when it advertises them; else in this browser. */
  serverPins: boolean;
  timezone?: string;
  /** `div` inside a virtual list, which names it a list item itself. */
  tag?: "li" | "div";
  /** One-line row for a narrow rail: every row marks its status, and the menu covers the time while shown. */
  compact?: boolean;
  /** The row sits under a section that names its status, so only screen readers get the word. */
  quietStatus?: boolean;
}

type RowAction =
  "float" | "stop" | "rename" | "pin" | "share" | "export" | "delete" | "deleteDraft";

const MAX_TITLE = 200;
const COUNTER_FROM = 180;
const KEBAB_CLASS = [
  "shrink-0 transition-opacity motion-reduce:transition-none",
  "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
  "group-data-[current]/row:opacity-100",
  "max-md:opacity-100 pointer-coarse:opacity-100",
];
// The compact kebab sits over the time, so the time reaches the row's end; a touch screen keeps it in line.
const COMPACT_KEBAB_CLASS =
  "absolute! end-2 group-focus-within/row:opacity-100 pointer-coarse:static!";
// The time steps aside wherever the kebab shows over it, and is never narrower than the kebab.
const COMPACT_TRAIL_CLASS = [
  "w-12 text-end",
  "pointer-fine:group-hover/row:invisible pointer-fine:group-focus-within/row:invisible",
  "pointer-fine:group-data-[current]/row:invisible pointer-fine:group-has-[[data-state=open]]/row:invisible",
];
</script>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import type { AssistantSignal } from "@/components/ai-assistant/common/AssistantStatusDot.types";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OContextMenu from "@/lib/overlay/ContextMenu/OContextMenu.vue";
import OContextMenuItem from "@/lib/overlay/ContextMenu/OContextMenuItem.vue";
import OContextMenuSeparator from "@/lib/overlay/ContextMenu/OContextMenuSeparator.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatOrgTime, formatRelativeCompact } from "@/utils/formatters";

import { chatStatusClass, chatStatusOf, chatStatusWord } from "./chatStatus";

// The Threads board's lights; a draft is at rest, so it has none.
const STATUS_SIGNALS: Partial<Record<ChatStatus, AssistantSignal>> = {
  needs_you: "attention",
  answering: "working",
  failed: "failed",
  expired: "failed",
};

const props = withDefaults(defineProps<AssistantHistoryRowProps>(), {
  status: undefined,
  expiresAt: null,
  now: undefined,
  org: null,
  agentIcon: null,
  sharedAs: null,
  floatBlocked: undefined,
  readonly: false,
  timezone: undefined,
  tag: "li",
  compact: false,
  quietStatus: false,
});

const emit = defineEmits<{
  open: [sid: Sid];
  navigate: [event: KeyboardEvent];
  rename: [sid: Sid, title: string];
  pin: [sid: Sid, pinned: boolean];
  float: [sid: Sid];
  stop: [sid: Sid];
  share: [sid: Sid];
  export: [sid: Sid];
  delete: [sid: Sid];
  "delete-draft": [sid: Sid];
}>();

interface RowMenuAction {
  id: RowAction;
  label: I18nText;
  icon: IconName;
  reason?: I18nText;
}

const { t } = useI18nTyped();
const button = ref<InstanceType<typeof OButton> | null>(null);
const renameInput = ref<InstanceType<typeof OInput> | null>(null);
const kebab = ref<InstanceType<typeof AssistantIconButton> | null>(null);
const renaming = ref(false);
const armed = ref(false);
const menuOpen = ref(false);
const chosen = ref(false);
const draft = ref("");
let cancelled = false;

const status = computed(() =>
  props.status === undefined ? chatStatusOf(props.row) : props.status,
);
const visibility = computed(() => props.row.share?.visibility ?? props.sharedAs);
const signal = computed<AssistantSignal | null>(() =>
  status.value ? (STATUS_SIGNALS[status.value] ?? null) : null,
);
const pendingText = computed(() =>
  props.pending ? t(`assistant.history.pending.${props.pending}`) : undefined,
);
const time = computed(() => formatRelativeCompact(props.row.updatedAt, props.now));
const absolute = computed(() =>
  formatOrgTime(props.row.updatedAt, { timeZone: props.timezone, absolute: true }),
);
const fullTitle = computed(() => raw(`${String(props.row.title)} · ${absolute.value}`));
const counter = computed(() => t("assistant.thread.titleCounter", { count: draft.value.length }));

// A browser-only row in server mode can still be read and removed, nothing more.
const actions = computed<RowMenuAction[]>(() => {
  if (props.org) return [];
  if (status.value === "draft")
    return [
      {
        id: "deleteDraft",
        label: t("assistant.history.deleteDraft"),
        icon: assistantGlyph.remove,
      },
    ];
  const browserOnly = props.serverMode && props.row.local;
  const list: RowMenuAction[] = [];
  if (!browserOnly)
    list.push({
      id: "float",
      label: t("assistant.history.openFloating"),
      icon: assistantGlyph.floatingWindow,
      reason: props.floatBlocked,
    });
  if (status.value === "answering")
    list.push({ id: "stop", label: t("assistant.history.stop"), icon: assistantGlyph.stopped });
  if (!props.readonly && !browserOnly) {
    list.push({ id: "rename", label: t("assistant.history.rename"), icon: assistantGlyph.edit });
    list.push({ id: "pin", label: pinLabel.value, icon: assistantGlyph.pin });
    list.push({ id: "share", label: t("assistant.share.share"), icon: assistantGlyph.share });
  }
  list.push({
    id: "export",
    label: t("assistant.history.exportMarkdown"),
    icon: assistantGlyph.download,
  });
  if (!props.readonly)
    list.push({
      id: "delete",
      label: t("assistant.history.deleteChat"),
      icon: assistantGlyph.remove,
    });
  return list;
});

const pinLabel = computed(() => {
  const local = !props.serverPins;
  if (props.row.pinned)
    return local ? t("assistant.history.unpinLocal") : t("assistant.history.unpin");
  return local ? t("assistant.history.pinLocal") : t("assistant.history.pin");
});

// Focus that landed on the stand-in kebab moves to the real trigger that replaces it.
async function arm(event?: Event): Promise<void> {
  if (armed.value) return;
  armed.value = true;
  const target = event?.target as HTMLElement | null;
  if (event?.type !== "focusin" || !target?.closest('[data-test="assistant-history-row-menu"]'))
    return;
  await nextTick();
  (kebab.value?.$el as HTMLElement | undefined)?.focus();
}

// A click that beat the arming opens the real menu once it is there.
async function openMenuSoon(): Promise<void> {
  armed.value = true;
  await nextTick();
  menuOpen.value = true;
}

function choose(): void {
  if (props.org) return;
  chosen.value = true;
  emit("open", props.row.sid);
}

function onRowKey(event: KeyboardEvent): void {
  if (event.key === "Enter" || event.key === " ") chosen.value = true;
  emit("navigate", event);
}

// The menu returns focus to its trigger as it closes; the field waits for that.
function run(action: RowAction): void {
  if (action === "rename") setTimeout(() => void startRename(), 0);
  else if (action === "pin") emit("pin", props.row.sid, !props.row.pinned);
  else if (action === "float") emit("float", props.row.sid);
  else if (action === "stop") emit("stop", props.row.sid);
  else if (action === "share") emit("share", props.row.sid);
  else if (action === "export") emit("export", props.row.sid);
  else if (action === "delete") emit("delete", props.row.sid);
  else emit("delete-draft", props.row.sid);
}

function isDestructive(action: RowAction): boolean {
  return action === "delete" || action === "deleteDraft";
}

async function startRename(): Promise<void> {
  draft.value = String(props.row.title);
  cancelled = false;
  renaming.value = true;
  await nextTick();
  renameInput.value?.focus();
  (renameInput.value?.$el as HTMLElement | undefined)?.querySelector("input")?.select();
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
  if (!cancelled && next && next !== String(props.row.title)) emit("rename", props.row.sid, next);
  void finishRename();
}

async function finishRename(): Promise<void> {
  renaming.value = false;
  await nextTick();
  focus();
}

function focus(): void {
  (button.value?.$el as HTMLElement | undefined)?.focus();
}

defineExpose({ focus, startRename });
</script>
