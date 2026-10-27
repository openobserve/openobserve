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
  <li
    class="border-border-default flex flex-col gap-2 border-b py-3 last:border-b-0"
    :data-test="`assistant-share-manager-row-${share.id}`"
    ref="rootEl"
    :data-pending="pending ? '' : undefined"
  >
    <div class="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1 max-md:flex-col">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <OButton
          v-if="own"
          ref="titleEl"
          variant="ghost"
          size="sm"
          class="max-w-full justify-start px-0 max-md:min-h-11"
          data-test="assistant-share-manager-row-title"
          @click="emit('openChat', share.session_id)"
        >
          <OTruncatedText class="text-text-heading min-w-0 text-sm font-medium">{{
            title
          }}</OTruncatedText>
        </OButton>
        <span v-else ref="titleEl" tabindex="-1" class="flex min-w-0 flex-col">
          <OTruncatedText
            class="text-text-heading min-w-0 text-sm font-medium"
            data-test="assistant-share-manager-row-title"
            >{{ title }}</OTruncatedText
          >
          <OText v-if="share.owner_name" variant="meta">{{
            t("assistant.share.sharedBy", { name: share.owner_name })
          }}</OText>
        </span>
        <span
          class="flex flex-wrap items-center gap-1"
          data-test="assistant-share-manager-row-tags"
        >
          <OTag
            type="assistantShare"
            :value="share.visibility"
            :label="
              share.visibility === 'public' ? t('assistant.share.public') : t('assistant.share.org')
            "
          />
          <OTag
            type="assistantShare"
            value="mode"
            :label="
              share.mode === 'live' ? t('assistant.share.liveMode') : t('assistant.share.snapshot')
            "
          />
          <OTag
            v-if="share.redact_tools"
            type="assistantShare"
            value="tools"
            :label="t('assistant.share.toolsHidden')"
          />
          <OTag
            v-if="share.hide_attachments"
            type="assistantShare"
            value="attachments"
            :label="t('assistant.share.attachmentsHiddenTag')"
          />
          <OTag
            v-if="outOfDate"
            type="assistantShare"
            value="outofdate"
            :label="t('assistant.share.outOfDateTag')"
            data-test="assistant-share-manager-row-out-of-date"
          />
        </span>
      </div>
      <div
        class="text-text-secondary flex shrink-0 flex-col items-end gap-0.5 text-xs max-md:items-start"
      >
        <span v-if="share.expires_at" class="flex items-center gap-1">
          {{ t("assistant.share.expires") }}
          <OTimeCell :value="share.expires_at" unit="us" />
        </span>
        <span v-else>{{ t("assistant.share.never") }}</span>
        <span data-test="assistant-share-manager-row-views">{{
          t("assistant.share.views", { count: share.access_count }, share.access_count)
        }}</span>
      </div>
    </div>

    <div v-if="mdUp" class="flex flex-wrap gap-2" data-test="assistant-share-manager-row-actions">
      <OButton
        v-for="action in actions"
        :key="action.id"
        :variant="action.id === 'revoke' ? 'ghost-destructive' : 'outline'"
        size="sm"
        :disabled="pending !== null || action.blocked !== undefined"
        :focusable-unavailable="action.blocked !== undefined"
        :loading="pending === action.id"
        :aria-label="action.name"
        :data-test="`assistant-share-manager-row-${action.id}`"
        @click="run(action.id)"
      >
        {{ action.label }}
        <template v-if="action.blocked" #unavailable-reason>{{ action.blocked }}</template>
        <OTooltip v-if="action.blocked" :content="action.blocked" />
      </OButton>
    </div>
    <ODropdown v-else align="end">
      <template #trigger>
        <AssistantIconButton
          :label="t('assistant.share.rowMenu', { title })"
          :icon="assistantGlyph.more"
          data-test="assistant-share-manager-row-menu"
        />
      </template>
      <ODropdownItem
        v-for="action in actions"
        :key="action.id"
        :variant="action.id === 'revoke' ? 'destructive' : 'default'"
        :disabled="pending !== null || action.blocked !== undefined"
        :focusable-unavailable="action.blocked !== undefined"
        :description="action.blocked ?? null"
        :data-test="`assistant-share-manager-row-menu-${action.id}`"
        @select="run(action.id)"
        >{{ action.label }}</ODropdownItem
      >
    </ODropdown>

    <OSelect
      v-if="confirm === 'expiry'"
      :model-value="null"
      :options="expiryOptions"
      :label="t('assistant.share.changeExpiry')"
      size="sm"
      class="max-md:w-full"
      data-test="assistant-share-manager-row-expiry-select"
      @update:model-value="changeExpiry"
    />
    <div
      v-else-if="confirm"
      ref="confirmEl"
      role="group"
      :aria-label="confirmText"
      class="border-border-default rounded-default flex flex-col gap-2 border p-3"
      data-test="assistant-share-manager-row-confirm"
    >
      <OText variant="body">{{ confirmText }}</OText>
      <div class="flex flex-wrap gap-2">
        <OButton
          :variant="confirm === 'revoke' ? 'destructive' : 'primary'"
          size="sm"
          class="max-md:min-h-11"
          :loading="pending !== null"
          data-test="assistant-share-manager-row-confirm-yes"
          @click="confirmYes"
          >{{
            confirm === "revoke" ? t("assistant.share.revoke") : t("assistant.share.show")
          }}</OButton
        >
        <OButton
          variant="outline"
          size="sm"
          class="max-md:min-h-11"
          data-test="assistant-share-manager-row-confirm-cancel"
          @click="cancel"
          >{{ t("common.cancel") }}</OButton
        >
      </div>
    </div>
  </li>
</template>

<script lang="ts">
import type { ShareView } from "@/services/ai_chat_share";
import type { I18nKey } from "@/types/i18n";

export interface AssistantShareRowProps {
  org: string;
  share: ShareView;
  /** The chat's turn is running; a snapshot cannot be updated mid-answer. */
  running?: boolean;
  outOfDate?: boolean;
  publicMaxExpiryDays: number;
}

export interface AssistantShareRowEmits {
  (e: "openChat", sessionId: string): void;
  (e: "announce", key: I18nKey): void;
}

export type ShareRowAction = "copy" | "refresh" | "mode" | "tools" | "expiry" | "revoke";
</script>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  type ComponentPublicInstance,
} from "vue";
import { useMutation } from "@tanstack/vue-query";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import useBreakpoint from "@/composables/useBreakpoint";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { UpdateShareRequest } from "@/services/ai_chat_share";
import { revokeShareMutation, updateShareMutation } from "@/services/ai_chat_share.queries";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";

import { expiryPresetsFor, otherMode, shareLinkOf } from "./chatShare";

interface RowAction {
  id: ShareRowAction;
  label: I18nText;
  name: I18nText;
  blocked?: I18nText;
}

const DAY_SECS = 86_400;

const props = withDefaults(defineProps<AssistantShareRowProps>(), {
  running: false,
  outOfDate: false,
});

const emit = defineEmits<AssistantShareRowEmits>();

const { t } = useI18nTyped();
const { mdUp } = useBreakpoint();

const pending = ref<ShareRowAction | null>(null);
const confirm = ref<"tools" | "revoke" | "expiry" | null>(null);
const confirmEl = ref<HTMLElement | null>(null);
const titleEl = ref<ComponentPublicInstance | HTMLElement | null>(null);
const rootEl = ref<HTMLElement | null>(null);

const updateMutation = useMutation(() => updateShareMutation(props.org));
const revokeMutation = useMutation(() => revokeShareMutation(props.org));

const title = computed(() => raw(props.share.title) || t("assistant.thread.newChatTitle"));
// The org-wide list never carries another member's token, so only the owner's rows act on the link.
const own = computed(() => !!props.share.token || !!props.share.url_path);

const actions = computed<RowAction[]>(() => {
  const name = title.value;
  const revoke: RowAction = {
    id: "revoke",
    label: t("assistant.share.revoke"),
    name: t("assistant.share.revokeFor", { title: name }),
  };
  if (!own.value) return [revoke];
  const share = props.share;
  const list: RowAction[] = [
    {
      id: "copy",
      label: t("assistant.share.copyLink"),
      name: t("assistant.share.copyLinkFor", { title: name }),
    },
  ];
  if (share.mode === "snapshot") {
    list.push({
      id: "refresh",
      label: t("assistant.share.updateSnapshot"),
      name: t("assistant.share.updateSnapshotFor", { title: name }),
      ...(props.running && { blocked: t("assistant.share.updateBlockedRow") }),
    });
  }
  list.push(
    {
      id: "mode",
      label:
        share.mode === "live"
          ? t("assistant.share.switchSnapshot")
          : t("assistant.share.switchLive"),
      name:
        share.mode === "live"
          ? t("assistant.share.switchSnapshotFor", { title: name })
          : t("assistant.share.switchLiveFor", { title: name }),
    },
    {
      id: "tools",
      label: share.redact_tools ? t("assistant.share.showTools") : t("assistant.share.hideTools"),
      name: share.redact_tools
        ? t("assistant.share.showToolsFor", { title: name })
        : t("assistant.share.hideToolsFor", { title: name }),
    },
    {
      id: "expiry",
      label: t("assistant.share.changeExpiry"),
      name: t("assistant.share.changeExpiryFor", { title: name }),
    },
    revoke,
  );
  return list;
});

const confirmText = computed(() =>
  confirm.value === "revoke"
    ? t("assistant.share.revokeConfirm")
    : t("assistant.share.showToolsConfirm"),
);

const expiryOptions = computed(() =>
  expiryPresetsFor(props.share.visibility, props.publicMaxExpiryDays * DAY_SECS).map((preset) => ({
    value: preset.value,
    label: preset.value === 0 ? t("assistant.share.never") : t(preset.labelKey),
  })),
);

onMounted(() => rootEl.value?.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => rootEl.value?.removeEventListener("keydown", onKeydown));

function run(id: ShareRowAction): void {
  const share = props.share;
  if (pending.value) return;
  if (id === "copy") return void copy();
  if (id === "refresh")
    return void update(id, { refresh_snapshot: true }, "assistant.share.snapshotUpdated");
  if (id === "mode") return void update(id, { mode: otherMode(share.mode) });
  if (id === "tools" && share.redact_tools && share.visibility === "public") return ask("tools");
  if (id === "tools") return void update(id, { redact_tools: !share.redact_tools });
  ask(id === "expiry" ? "expiry" : "revoke");
}

function ask(kind: "tools" | "revoke" | "expiry"): void {
  confirm.value = kind;
  void nextTick(() => confirmEl.value?.querySelector<HTMLElement>("button")?.focus());
}

function confirmYes(): void {
  if (confirm.value === "revoke") void revoke();
  else void update("tools", { redact_tools: false }).then(() => (confirm.value = null));
}

function cancel(): void {
  confirm.value = null;
}

function changeExpiry(value: unknown): void {
  const secs = Number(value);
  if (!Number.isFinite(secs)) return;
  confirm.value = null;
  void update("expiry", { expires_in_secs: secs > 0 ? secs : null });
}

async function copy(): Promise<void> {
  const share = props.share;
  if (await copyToClipboard(shareLinkOf(share), t, { silent: true }))
    emit("announce", "assistant.share.copied");
  trackAssistant("ai_share", {
    action: "copy_link",
    visibility: share.visibility,
    mode: share.mode,
  });
}

async function update(id: ShareRowAction, body: UpdateShareRequest, done?: I18nKey): Promise<void> {
  const share = props.share;
  pending.value = id;
  try {
    await updateMutation.mutateAsync({ id: share.id, body });
    trackAssistant("ai_share", {
      action: id === "refresh" ? "refresh" : "update",
      visibility: share.visibility,
      mode: body.mode ?? share.mode,
    });
    if (done) emit("announce", done);
  } catch {
    toast({
      variant: "error",
      message: t("assistant.share.updateFailed"),
      action: { label: t("common.retry"), handler: () => void update(id, body, done) },
    });
  } finally {
    pending.value = null;
  }
}

async function revoke(): Promise<void> {
  const share = props.share;
  pending.value = "revoke";
  try {
    await revokeMutation.mutateAsync(share.id);
    trackAssistant("ai_share", {
      action: "revoke",
      visibility: share.visibility,
      mode: share.mode,
    });
    confirm.value = null;
    emit("announce", "assistant.share.revoked");
  } catch {
    toast({
      variant: "error",
      message: t("assistant.share.revokeFailed"),
      action: { label: t("common.retry"), handler: () => void revoke() },
    });
  } finally {
    pending.value = null;
  }
}

// An inline confirm keeps Tab inside it and takes Escape before the drawer does.
function onKeydown(event: KeyboardEvent): void {
  if (!confirm.value || event.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    confirm.value = null;
    return;
  }
  if (event.key !== "Tab" || !confirmEl.value) return;
  const buttons = Array.from(confirmEl.value.querySelectorAll<HTMLElement>("button"));
  const index = buttons.indexOf(document.activeElement as HTMLElement);
  event.preventDefault();
  buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
}

function focusTitle(): void {
  const el = titleEl.value;
  const node = el && "$el" in el ? (el.$el as HTMLElement) : (el as HTMLElement | null);
  node?.focus();
}

defineExpose({ focusTitle });
</script>
