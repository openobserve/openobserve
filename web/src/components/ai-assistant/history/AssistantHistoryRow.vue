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
      'group/row rounded-default hover:bg-surface-subtle relative flex min-w-0 items-center gap-1 ps-1',
      current ? 'border-s-border-strong border-s-2' : 'border-s-2 border-s-transparent',
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
    <OContextMenu v-else :disabled="readonly || !!pending">
      <template #trigger>
        <OButton
          ref="button"
          variant="ghost"
          size="sm"
          block
          :tabindex="tabbable ? 0 : -1"
          :aria-current="current ? 'true' : undefined"
          class="h-auto! min-h-8 min-w-0 flex-1 justify-start! py-1.5 text-start max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-history-row"
          @click="emit('open', row.sid)"
          @keydown="(event: KeyboardEvent) => emit('navigate', event)"
        >
          <span
            class="flex min-w-0 flex-1 flex-col gap-0.5 @min-[20rem]:flex-row @min-[20rem]:items-center @min-[20rem]:gap-2"
          >
            <span class="flex min-w-12 flex-1 items-center gap-1.5">
              <OIcon
                v-if="row.pinned"
                :name="assistantGlyph.pin"
                size="xs"
                class="text-text-secondary shrink-0"
                aria-hidden="true"
              />
              <OTruncatedText
                :class="['text-text-body min-w-12 flex-1', current && 'font-medium']"
                :tooltip="fullTitle"
                >{{ row.title }}</OTruncatedText
              >
            </span>
            <!-- The button is named by its content; these keep the spoken parts apart. -->
            <span class="sr-only">, </span>
            <span class="flex shrink-0 items-center gap-1.5">
              <template v-if="pending">
                <OSpinner size="xs" />
                <OText variant="meta" data-test="assistant-history-row-pending">{{
                  pendingText
                }}</OText>
              </template>
              <template v-else>
                <AssistantStatusDot
                  v-if="row.pendingApproval"
                  state="attention"
                  placement="inline"
                />
                <AssistantStatusDot v-else-if="row.activeTurn" state="working" placement="inline" />
                <OText
                  v-if="row.pendingApproval || row.activeTurn"
                  variant="meta"
                  data-test="assistant-history-row-state"
                  >{{
                    row.pendingApproval
                      ? t("assistant.history.needsYou")
                      : t("assistant.history.running")
                  }}</OText
                >
                <OText v-else variant="meta" as="span" data-test="assistant-history-row-time">{{
                  time
                }}</OText>
              </template>
              <span v-if="originTag" class="sr-only">, </span>
              <OTag
                v-if="originTag"
                type="assistantOrigin"
                :value="originTag"
                size="xs"
                data-test="assistant-history-row-origin"
              />
            </span>
          </span>
        </OButton>
      </template>
      <template v-for="action in actions" :key="action.id">
        <OContextMenuSeparator v-if="action.id === 'delete'" />
        <OContextMenuItem
          v-if="action.id === 'download'"
          :icon-left="assistantGlyph.download"
          @select="emit('download', row.sid, 'markdown')"
        >
          {{ t("assistant.history.download") }} · {{ t("assistant.thread.downloadMarkdown") }}
        </OContextMenuItem>
        <OContextMenuItem
          v-if="action.id === 'download'"
          :icon-left="assistantGlyph.download"
          @select="emit('download', row.sid, 'json')"
        >
          {{ t("assistant.history.download") }} · {{ t("assistant.thread.downloadJson") }}
        </OContextMenuItem>
        <OContextMenuItem
          v-else
          :variant="action.id === 'delete' ? 'destructive' : 'default'"
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
      :class="KEBAB_CLASS"
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
          :class="KEBAB_CLASS"
          data-test="assistant-history-row-menu"
        />
      </template>
      <template v-for="action in actions" :key="action.id">
        <ODropdownSeparator v-if="action.id === 'delete'" />
        <ODropdownSub v-if="action.id === 'download'" :text-value="action.label">
          <template #icon-left><OIcon :name="assistantGlyph.download" size="sm" /></template>
          <template #trigger>{{ action.label }}</template>
          <ODropdownItem
            data-test="assistant-history-row-download-markdown"
            @select="emit('download', row.sid, 'markdown')"
          >
            {{ t("assistant.thread.downloadMarkdown") }}
          </ODropdownItem>
          <ODropdownItem
            data-test="assistant-history-row-download-json"
            @select="emit('download', row.sid, 'json')"
          >
            {{ t("assistant.thread.downloadJson") }}
          </ODropdownItem>
        </ODropdownSub>
        <ODropdownItem
          v-else
          :variant="action.id === 'delete' ? 'destructive' : 'default'"
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

export interface AssistantHistoryRowProps {
  row: HistoryRow;
  current: boolean;
  mode: "popover" | "rail" | "drawer";
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
}

type RowAction = "open" | "rename" | "pin" | "download" | "delete";

const MAX_TITLE = 200;
const COUNTER_FROM = 180;
const KEBAB_CLASS = [
  "shrink-0 transition-opacity motion-reduce:transition-none",
  "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
  "max-md:opacity-100 pointer-coarse:opacity-100",
];
</script>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OTag from "@/lib/core/Badge/OTag.vue";
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
import ODropdownSub from "@/lib/overlay/Dropdown/ODropdownSub.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

const props = withDefaults(defineProps<AssistantHistoryRowProps>(), {
  readonly: false,
  timezone: undefined,
  tag: "li",
});

const emit = defineEmits<{
  open: [sid: Sid];
  navigate: [event: KeyboardEvent];
  rename: [sid: Sid, title: string];
  pin: [sid: Sid, pinned: boolean];
  download: [sid: Sid, format: "markdown" | "json"];
  delete: [sid: Sid];
}>();

const { t } = useI18nTyped();
const button = ref<InstanceType<typeof OButton> | null>(null);
const renameInput = ref<InstanceType<typeof OInput> | null>(null);
const kebab = ref<InstanceType<typeof AssistantIconButton> | null>(null);
const renaming = ref(false);
const armed = ref(false);
const menuOpen = ref(false);
const draft = ref("");
let cancelled = false;

const pendingText = computed(() =>
  props.pending ? t(`assistant.history.pending.${props.pending}`) : undefined,
);
const originTag = computed(() => {
  if (props.serverMode && props.row.local) return "browser";
  return props.row.origin === "none" ? null : props.row.origin;
});
const time = computed(() => formatOrgTime(props.row.updatedAt, { timeZone: props.timezone }));
const absolute = computed(() =>
  formatOrgTime(props.row.updatedAt, { timeZone: props.timezone, absolute: true }),
);
const fullTitle = computed(() => raw(`${String(props.row.title)} · ${absolute.value}`));
const counter = computed(() => t("assistant.thread.titleCounter", { count: draft.value.length }));

// A browser-only row in server mode can still be read, downloaded and removed, nothing more.
const actions = computed<{ id: RowAction; label: I18nText }[]>(() => {
  const browserOnly = props.serverMode && props.row.local;
  const list: { id: RowAction; label: I18nText }[] = [
    { id: "open", label: t("assistant.history.open") },
  ];
  if (!props.readonly && !browserOnly) {
    list.push({ id: "rename", label: t("assistant.history.rename") });
    list.push({ id: "pin", label: pinLabel.value });
  }
  list.push({ id: "download", label: t("assistant.history.download") });
  if (!props.readonly) list.push({ id: "delete", label: t("assistant.history.deleteAction") });
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

// The menu returns focus to its trigger as it closes; the field waits for that.
function run(action: RowAction): void {
  if (action === "open") emit("open", props.row.sid);
  else if (action === "rename") setTimeout(() => void startRename(), 0);
  else if (action === "pin") emit("pin", props.row.sid, !props.row.pinned);
  else if (action === "delete") emit("delete", props.row.sid);
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
